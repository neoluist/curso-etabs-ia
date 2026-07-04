import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Cpu,
  Key,
  MessageSquare,
  Play,
  Send,
  Settings,
  X,
  Zap
} from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Renderiza una expresion LaTeX a HTML (KaTeX) para la memoria de calculo.
function tex(expr, display = false) {
  try {
    return katex.renderToString(String(expr), { throwOnError: false, displayMode: display });
  } catch {
    return String(expr);
  }
}

// --- Resaltador de sintaxis Python AUTOCONTENIDO (sin dependencias / sin CDN) ---
// Filosofia de la app (offline-safe, determinista): en vez de prismjs/highlight.js
// tokenizamos con una sola pasada de regex. Reconoce comentarios, cadenas (triples y
// con prefijo r/f/b), numeros, decoradores, palabras clave, constantes, builtins y
// llamadas a funcion. SIEMPRE escapa HTML (evita inyeccion desde el codigo del editor).
const PY_KW = new Set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const PY_CONST = new Set('True False None'.split(' '));
const PY_BUILTIN = new Set('print range len int float str bool list dict tuple set frozenset abs min max sum round enumerate zip open isinstance issubclass super type object hasattr getattr setattr delattr repr sorted reversed map filter format input bytes bytearray hex oct bin ord chr divmod pow vars dir id callable iter next any all Exception RuntimeError ValueError TypeError KeyError IndexError AttributeError ImportError ZeroDivisionError self'.split(' '));

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightPython(code) {
  // Orden de alternativas = prioridad: comentario, cadena triple, cadena simple
  // (con prefijo y comilla de cierre OPCIONAL para no romper mientras se escribe),
  // numero, decorador, identificador.
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?''')|((?:[rbfRBF]{1,2})?"(?:\\.|[^"\\\n])*"?|(?:[rbfRBF]{1,2})?'(?:\\.|[^'\\\n])*'?)|(\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d[\d_]*)|(@[A-Za-z_]\w*)|([A-Za-z_]\w*)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += escHtml(code.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) out += `<span class="tk-com">${escHtml(m[1])}</span>`;
    else if (m[2] !== undefined) out += `<span class="tk-str">${escHtml(m[2])}</span>`;
    else if (m[3] !== undefined) out += `<span class="tk-str">${escHtml(m[3])}</span>`;
    else if (m[4] !== undefined) out += `<span class="tk-num">${escHtml(m[4])}</span>`;
    else if (m[5] !== undefined) out += `<span class="tk-dec">${escHtml(m[5])}</span>`;
    else if (m[6] !== undefined) {
      const w = m[6];
      if (PY_KW.has(w)) out += `<span class="tk-kw">${w}</span>`;
      else if (PY_CONST.has(w)) out += `<span class="tk-const">${w}</span>`;
      else if (PY_BUILTIN.has(w)) out += `<span class="tk-bi">${w}</span>`;
      else if (/^\s*\(/.test(code.slice(last, last + 16))) out += `<span class="tk-fn">${w}</span>`;
      else out += escHtml(w);
    }
  }
  if (last < code.length) out += escHtml(code.slice(last));
  return out;
}

/*
  ETABS API + IA CONTROLADA
  ------------------------------------------------
  HISTORIAL DE VERSIONES:
  - v3.59.0 PASO "CORRER 2DO ANÁLISIS SÍSMICO" IMPLEMENTADO — CIERRA EL FLUJO (todos los pasos nuevos
            ya están implementados). Tras verificar el sistema (R₀) y las irregularidades (Ia/Ip),
            R = R₀·Ia·Ip cambió → el espectro (Sa = Z·U·C·S·g/R) y los factores de deriva también; este
            paso, en un clic: DESBLOQUEA el modelo (SetModelIsLocked False, descarta el 1er análisis) →
            RE-APLICA el espectro (buildSpectrumBody con espectroParams actuales) → RE-APLICA las
            combinaciones (buildLoadCombosBody con comboParams) → RE-CORRE el análisis (buildAnalyzeBody).
            buildSegundoAnalisisBody COMPONE los 3 builders validados renombrando su construir_modelo a
            _seg_espectro/_seg_combos/_seg_analisis y llamándolos en secuencia desde un construir_modelo
            envoltorio (cero duplicación de lógica). espectroParams/comboParams ya están auto-vinculados a
            disenoEspectro (useEffect) → el R corregido entra solo. Form formAnalizar2 muestra el R·X/R·Y
            y los factores de deriva que se usarán + ruta .EDB. analizar2 implementado:true (deps
            verifsistema + verifirreg). Solo FRONTEND (App.jsx v3.59.0, usa /execute-etabs y los builders
            existentes; servidor SIGUE v1.31.0, NO reiniciar). Validado: vite build + UI en preview. CON
            ESTO EL FLUJO GUIADO ESTÁ COMPLETO: todos los WORKFLOW_STEPS tienen implementado:true.
  - v3.58.0 PASO "ASIGNAR RELEASE" (liberación de momentos en vigas) IMPLEMENTADO + por SELECCIÓN
            (pedido del usuario: "no quiero aplicarlo a todas, solo a ciertas vigas; ¿lanzar un mensaje
            que diga que seleccione las vigas en ETABS y a partir de eso asignar?"). EXACTO: el release
            se aplica a la SELECCIÓN actual de ETABS — el usuario selecciona las vigas (clic/ventana) y la
            app lee SelectObj.GetSelected (ObjectType 2 = Frame). buildReleaseBody: alcance 'seleccion'
            (default) | 'todas' | 'seccion'; filtro «solo vigas» (GetDesignOrientation==2, evita liberar
            columnas); arrays II/JJ[6] (U1,U2,U3,R1,R2,R3) con M3=idx5, M2=idx4, torsión=R1 idx3; aplica
            FrameObj.SetReleases por viga y REPORTA los frames que ETABS rechace por inestabilidad (no
            aborta). Default M3 en i+j (viga rotulada a flexión). Form formRelease con selector de alcance,
            checkboxes M3/M2/torsión por extremo, y botón "🔎 Leer selección de ETABS" (buildReleaseCheckBody,
            solo lectura: cuenta vigas seleccionadas). release implementado:true. VALIDADO EN VIVO el
            mecanismo de selección (seleccioné 3 frames por API → GetSelected devolvió 3 tipo 2 = vigas →
            limpié; SetReleases/GetReleases confirmados). Solo FRONTEND (App.jsx v3.58.0, servidor sigue
            v1.31.0, NO reiniciar; usa el /execute-etabs ya existente). PENDIENTE del flujo: solo queda el
            2do análisis sísmico.
  - v3.57.0 PASO "VERIFICAR SISTEMA ESTRUCTURAL" IMPLEMENTADO (E.030 Tabla N°8, Artículo 20). verifsistema
            → implementado:true, modal ancho (920px): clasifica el sistema de concreto por el % del
            CORTANTE EN LA BASE que toman los muros, POR DIRECCIÓN → fija R₀. SISTEMAS_TABLA8 (Pórticos
            R₀=8 «muros≤20%» · Dual R₀=7 «20%<muros<70%» · Muros R₀=6 «muros≥70%» · EMDL R₀=3,5) +
            clasificarSistemaMuros(frac). NUEVO endpoint GET /etabs/cortante-sistema?pid=&casoX=&casoY=
            (servidor v1.31.0, leer_cortante_sistema): vTotal = |BaseReact| del caso; vMuros = Σ|V2|
            (cortante EN EL PLANO) de los muros-Pier en el piso BASE (tabla "Pier Forces", Location
            Bottom; piso base = menor elevación). El form: botón "🔎 Leer del modelo (Pier Forces)" que
            rellena el % por dirección (editable a mano), clasifica con la Tabla N°8, avisa si DIFIERE del
            sistema declarado y aplica R₀ con "Aplicar a X/Y" (set sistemaX/sistemaY en disenoEspectro →
            R). EMDL se elige a mano (depende de densidad de muros). Si no hay muros-Pier (ΣV2=0) avisa y
            asume Pórticos. Estado verifSistema + sisInput + handleVerifSistema. SUBE EXPECTED_SERVER_VERSION
            a 1.31.0 → REINICIAR EL SERVIDOR. Validado: vite build + py_compile + endpoint end-to-end vs
            modelo real (pisoBase=Story1, total 0 sin análisis) + esquema "Pier Forces" por MCP + UI en
            preview con % a mano.
  - v3.56.0 VERIFICAR IRREGULARIDADES · "ESQUINAS ENTRANTES" AUTOMÁTICA (última geométrica). Se integra
            al mismo botón de geometría (handleVerifGeom calcula ahora 4: vertical, diafragma, no
            paralelos y esquinas; un solo /etabs/modelo-geometria). calcEsquinasIrreg: construye una
            REJILLA DE OCUPACIÓN de las losas (celdas entre los x/y distintos de los polígonos; centro de
            celda dentro de alguna losa = ocupada); en cada una de las 4 esquinas del rectángulo
            envolvente que esté VACÍA mide la proyección del entrante en X (ax) y en Y (ay) y marca
            'esquinas' en ipX/ipY si ax>0,20·Lx Y ay>0,20·Ly (criterio E.030: en AMBAS direcciones). Las
            aberturas interiores las cubre Diafragma (separadas). Tarjeta con tabla piso/esquina/a÷Lx/
            b÷Ly/estado. Solo FRONTEND (App.jsx v3.56.0, servidor sigue v1.30.0, NO reiniciar). AUTO ya
            cubre 9 de 13 nodos (Masa, Torsional/ext, Rigidez/ext, Geom. vertical, Diafragma, No
            paralelos, Esquinas); quedan MANUALES Resistencia/piso débil (resistencia/resistExt) y
            Discontinuidad de sistemas (disc/discExt) — necesitan capacidad de diseño / fracción de
            cortante. Validado: vite build + EN VIVO vs modelo real (planta rectangular 280 m² → sin
            esquina entrante, regular).
  - v3.55.0 VERIFICAR IRREGULARIDADES · 3 GEOMÉTRICAS AUTOMÁTICAS (4ta tanda de las "uno a uno"):
            Geométrica vertical (Ia), Discontinuidad del diafragma (Ip) y Sistemas no paralelos (Ip).
            SE CALCULAN DE LA GEOMETRÍA del modelo (NO necesitan análisis) → un solo botón "🔎 Verificar
            automáticamente (geometría)" en las 3 tarjetas dispara UNA lectura de /etabs/modelo-geometria
            (endpoint ya existente, SIN tocar el servidor) y calcula las tres. calcGeomVertical: dimensión
            en planta del sistema resistente (cols+vigas+muros) por piso, X/Y; irregular si >1,3× el piso
            adyacente (azotea excluida) → geomVert en iaX/iaY. calcDiafragmaIrreg: área de losa ÷ área
            bruta (rectángulo envolvente) por piso; abertura >50% → diafragma en ipX/ipY. calcNoParaleloIrreg:
            muros/vigas con desviación ≥30° de los ejes → noParalelo en ipX/ipY (el criterio del 10% de
            cortante se confirma a mano). Estado verifGeom (una lectura, 3 resultados) + handleVerifGeom;
            helper geomVerifBlock(tipo) compartido por las 3 tarjetas. Solo FRONTEND (App.jsx v3.55.0,
            servidor sigue v1.30.0, NO reiniciar). Quedan manuales: Resistencia/piso débil y Discontinuidad
            de sistemas resistentes (necesitan capacidad de diseño / fracción de cortante). Validado: vite
            build + EN VIVO contra el modelo real (geometría leída, cálculo y marcado correctos).
  - v3.54.0 VERIFICAR IRREGULARIDADES · "RIGIDEZ / PISO BLANDO" AUTOMÁTICA (3ra de las "uno a uno").
            Las tarjetas Rigidez–Piso blando y Extrema de rigidez ganan botón "🔎 Verificar
            automáticamente (Story Stiffness)". NUEVO endpoint GET /etabs/rigidez?pid=&casos= (servidor
            v1.30.0, función leer_rigidez_piso): lee la tabla "Story Stiffness" (cols validadas en vivo:
            Story, OutputCase, ShearX, DriftX, StiffXh, StiffX kgf/m, ShearY, DriftY, StiffYh, StiffY,
            Irregular) — StiffX/StiffY = K = V/Δ; OJO StiffX se matchea EXACTO (StiffXh también contiene
            'stiffx'). calcRigidezIrreg evalúa POR DIRECCIÓN X/Y: K de cada piso vs el entrepiso
            inmediato SUPERIOR y vs el PROMEDIO de los 3 superiores. Piso blando: K<0,70·K_sup o
            <0,80·prom3 (Ia=0,75); extrema: K<0,60 o <0,70 (Ia=0,50). El piso tope no se evalúa. Marca
            rigidez/rigidezExt en iaX/iaY → R por dirección. Tabla piso/dir/K÷K_sup/K÷prom3/estado +
            resumen. verifRigidez + handleVerifRigidez (casos espectroParams.casoX/Y + CSX/CSY). Requiere
            modelo analizado. La RESISTENCIA/piso débil queda manual (necesita capacidad de diseño, no
            solo análisis). SUBE EXPECTED_SERVER_VERSION a 1.30.0 → REINICIAR EL SERVIDOR. Validado: vite
            build + py_compile + endpoint end-to-end vs modelo real (rigidez:[] sin error) + esquema de
            tabla por MCP + UI en preview con datos de prueba.
  - v3.53.0 VERIFICAR IRREGULARIDADES · "TORSIONAL / TORSIONAL EXTREMA" AUTOMÁTICA (2da de las
            "uno a uno"). Las tarjetas Torsional y Torsional extrema ganan botón "🔎 Verificar
            automáticamente (Story Max/Avg Drifts)". NUEVO endpoint servidor GET /etabs/torsion?pid=&casos=
            (servidor v1.29.0): lee la tabla "Story Max Over Avg Drifts" (columnas validadas en vivo:
            Story, OutputCase, Direction, Max Drift, Avg Drift, Ratio) seleccionando los casos sísmicos
            (SetLoadCasesSelectedForDisplay) y devuelve la razón Δmax/Δprom por piso/caso/dirección.
            calcTorsionIrreg (frontend) evalúa POR DIRECCIÓN X/Y (independientes): solo pisos con
            Δmax > 50% del permisible (E.030); razón gobernante > 1,5 → torsional EXTREMA (Ip=0,60), > 1,3
            → torsional (Ip=0,75). Marca torsion/torsionExt en ipX/ipY → R se actualiza por dirección.
            Tabla piso/caso/dir/razón/estado + resumen por dirección. Estado verifTorsion + handler
            handleVerifTorsion (usa espectroParams.casoX/Y y comboParams.casoSismoX/Y + CSX/CSY/DERVX/DERVY).
            Requiere modelo analizado con diafragmas rígidos; si no hay datos, avisa. SUBE
            EXPECTED_SERVER_VERSION a 1.29.0 → REINICIAR EL SERVIDOR. Validado: vite build + servidor
            compila + lectura en vivo contra el modelo real (tabla confirmada; devuelve vacío sin error
            por estar sin analizar) + UI en preview con datos de prueba.
  - v3.52.0 LAS 13 IRREGULARIDADES COMO NODOS DEL DIAGRAMA (pedido del usuario: "pero todos los
            botones de irregularidades colócalas"). Bajo el paso "Verificar irregularidades sísmicas"
            se dibuja una rejilla de 13 cajas clicables (grupo punteado rosa "Tipos de irregularidad
            E.030", sub-cabeceras Altura (Ia) Tabla N°11 / Planta (Ip) Tabla N°12, conector desde el
            nodo padre). Constante IRREG_NODOS (8 altura grupo 'A' campos iaX/iaY + 5 planta grupo 'P'
            campos ipX/ipY). Cada nodo: se colorea rosa si está marcada (⚠) / cian si disponible /
            gris si bloqueada; clic abre un MODAL INDIVIDUAL (estado openIrreg) con su esquema, criterio,
            checkboxes X/Y y, para masa, el botón de verificación automática. Refactor: la tarjeta se
            extrajo a renderIrregCard + toggleIrregDir (component scope) y la reusan el panel general
            (formVerifIrreg) y el modal individual. Los nodos respetan la disponibilidad del paso
            (bloqueados hasta el 1er análisis). CANVAS_H 640→700 para la rejilla. Solo frontend (App.jsx
            v3.52.0, servidor sigue v1.28.0, NO reiniciar).
  - v3.51.0 VERIFICAR IRREGULARIDADES · "MASA O PESO" AUTOMÁTICA (1ra de las "uno a uno"; el usuario
            eligió empezar por Masa). La tarjeta Masa o peso gana un botón "🔎 Verificar automáticamente
            (Mass Summary)" que REUSA /etabs/extraer-modelo (masas_piso de "Mass Summary by Story", ya
            validado en vivo — SIN tocar el servidor) y aplica el criterio E.030 P_piso > 1,5·P_adyacente
            con calcMasaIrreg: excluye Base/Total, EXENTA azotea (tope) y sótanos, y compara cada piso
            evaluable con sus adyacentes evaluables (g se cancela → masa≡peso). Muestra una tabla piso /
            peso (t) / P÷P_adyacente / estado (ok · >1,5 ⚠ · exento) y, si detecta irregularidad, marca
            'masa' en X e Y (la masa NO es direccional) → Ia=0,90 y R se actualizan en todo el flujo
            (misma fuente disenoEspectro). Si las masas salen 0, avisa que falta correr el análisis. El
            engineer puede ajustar el check a mano (lo determinista + el usuario revisa). Estado verifMasa
            + handleVerifMasa. Solo frontend (App.jsx v3.51.0, servidor sigue v1.28.0, NO reiniciar).
  - v3.50.0 PASO "VERIFICAR IRREGULARIDADES SÍSMICAS" — INFO + ESQUEMAS (1ra etapa; "uno a uno
            iremos configurando"). El paso verifirreg pasa a implementado:true y abre un panel ancho
            (920px) con: (1) intro E.030 (R = R₀·Ia·Ip, Ia/Ip = mínimo de las presentes); (2) resumen
            en vivo Ia/Ip/R por dirección + etiqueta regular/IRREGULAR; (3) las 8 irregularidades en
            ALTURA (Tabla N°11) y 5 en PLANTA (Tabla N°12), cada una con su ESQUEMA SVG, número de
            tabla, factor, umbral, el CRITERIO fiel a la E.030-2026 y de dónde sale el dato a verificar,
            + checkbox Existe en X / Existe en Y. Las constantes IRREG_ALTURA/IRREG_PLANTA se enriquecen
            (tabla, umbral, criterio, como, esquema) SIN tocar id/nombre/f (los usa el espectro/memoria).
            Componente nuevo EsquemaIrreg (dibujos: pisoBlando, pisoDebil, masa, geomVert, discontinuidad,
            torsion, esquinas, diafragmaPlanta, noParalelo). El marcado usa disenoEspectro — la MISMA
            fuente que «El Espectro de Diseño» → R se actualiza en todo el flujo. Botón "Marcar revisada"
            (marcarPaso). La verificación AUTOMÁTICA desde los resultados del análisis se sumará una por
            una. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.49.6 DXF TRAPEZOIDAL en ETABS (builder): buildNonUniformGridBody ahora DEDUPLICA — un eje
            ORTOGONAL que coincide con un eje inclinado/general se OMITE (lo reemplaza el inclinado), y si
            una dirección queda sin ortogonales, los de la otra se convierten también a generales (2 puntos)
            → grilla 100% "General", fiel al trapecio. Antes ETABS dibujaba la grilla recta ENCIMA del
            trapecio (el usuario: "en etabs debe ser lo mismo"). VALIDADO EN VIVO (ETABS 22, PID 29044):
            ETABS SÍ acepta un sistema Cartesiano con SOLO líneas General (ApplyEditedTables=[0,0,0]); el
            trapecio quedó con 8 líneas General (EI1,EI2,A,B,C + 2,3,4) y 0 ortogonales. OJO: el paso
            "Crear grilla" hace File.NewBlank → NO re-ejecutar sobre un modelo con estructura (lo borra);
            para un modelo ya construido, reescribir SOLO la tabla "Grid Definitions - Grid Lines" por PID
            (sin NewBlank). Solo frontend (servidor v1.28.0, NO reiniciar).
  - v3.49.5 DXF PLANTA TRAPEZOIDAL: cuando los bordes sup/inf (o izq/der) están inclinados, los ejes
            ortogonales extremos (1 y 5) ya NO se dibujan rectos — se reemplazan por los ejes inclinados,
            y los ejes PERPENDICULARES (A, B, C) se devuelven como ejes de 2 puntos que TERMINAN/INICIAN en
            esos bordes (pedido del usuario, con su elección: A, B y C). extraerEjesDeDxf: detecta skewX/
            skewY (los 2 ejes extremos de una dirección inclinados) y emite los perpendiculares como ejes
            de 2 puntos recortados a los bordes (yAt/xAt sobre las aristas). Las luces se MANTIENEN intactas
            (origen/elevación) y en SvgPlanta las líneas ortogonales que COINCIDEN con un eje inclinado se
            OCULTAN (hideX/hideY, tol 5% del vano) → el extremo recto desaparece, lo reemplaza el inclinado.
            Validado con el DXF real: A(0,0)→(0,14.49), B(3.325,0.225)→(3.325,14.63), C(5.7,0.386)→(5.7,
            14.74) cierran contra EI1(0,0)→(5.7,0.386) y EI2(0,14.49)→(5.7,14.74). PENDIENTE: el builder
            (buildNonUniformGridBody) aún crea en ETABS los ortogonales + inclinados → al CREAR habría
            duplicados; falta deduplicar ahí (validar en ETABS real). Solo frontend (servidor v1.28.0).
  - v3.49.4 DXF: tras importar, la VISTA PREVIA se actualiza COMPLETA (el usuario: "es como borrar todo
            lo anterior"). Bug: si venía de un "Leer modelo" (fuenteGrilla='real'), la previa seguía
            dibujando esa grilla (gridReal, 5 ejes) e ignoraba las luces del DXF — solo los ejes inclinados
            (overlay aparte) se veían nuevos. Fix: aplicarDxf, al detectar ejes (ok), hace setFuenteGrilla(
            'uniforme') → la previa vuelve a leer las luces del FORMULARIO (espaciamientosX/Y importadas).
            Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.49.3 DXF: RESCATA ejes intermedios dibujados CORTOS. El usuario: "pusiste los ejes inclinados
            pero falta el resto de los ejes". En su DXF el eje X intermedio (x=330.74, eje 2) es una línea
            de solo 3.79 m (no cruza toda la planta) y el filtro len>=0.5·refX (umbral 7.21) la DESCARTABA
            → solo 2 ejes X, luces=[5.7] en vez de 3 ejes con luces=[3.325, 2.375]. Fix en extraerEjesDeDxf:
            los ejes LARGOS definen el RECUADRO (dxfBBox) y se RESCATAN las líneas cortas (len>=0.1·ref) que
            caen DENTRO de él → así no se cuela la marca de origen (-0.5,-0.5)→(0.5,0.5), que queda fuera.
            Validado con el DXF real: 9 líneas → 3 ejes X [3.325, 2.375] + 5 ejes Y + 2 inclinados (intactos).
            Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.49.2 DXF basado en los PUNTOS reales (maneja grillas NO ortogonales) — el usuario subió un plano
            TRAPEZOIDAL (ejes A/E inclinados) y salían mal: el algoritmo viejo clasificaba horizontal/
            vertical/inclinado por ángulo y descartaba los ejes inclinados (comparaba su largo contra la
            ALTURA, no el ancho) → perdía 2 de 5 ejes Y. Reescrito extraerEjesDeDxf: clasifica cada línea
            por su DIRECCIÓN principal (se extiende más en X → eje "Y" A,B,C; más en Y → eje "X" 1,2,3),
            filtra por largo de referencia POR dirección, y toma la ORDENADA de cada eje en un BORDE de
            referencia (izq/inferior) interpolando sobre la línea → las luces salen bien aunque el eje
            esté inclinado; los ejes inclinados (extremos con cota distinta) se devuelven con sus 2
            PUNTOS reales. Validado contra el DXF real del usuario: lucesX=[5.7], lucesY=[4.02,4.58,2.85,
            3.05] (5 ejes A–E), 2 inclinados A(0,0)→(5.7,0.39) y E(0,14.49)→(5.7,14.74). Solo frontend.
  - v3.49.1 DXF más ROBUSTO + DIAGNÓSTICO (el usuario subió su DXF y no detectó ejes en la capa "0").
            extraerEjesDeDxf: los umbrales de "línea larga" ahora son RELATIVOS a la línea más larga de
            cada tipo (antes 0.4·extensión global → si el DXF trae membrete/recuadro, los ejes quedaban
            "cortos" y se descartaban). parseDxfEntities ahora soporta POLYLINE (pesada, con VERTEX) y
            devuelve layerCounts. El selector de CAPA muestra el nº de líneas por capa (para elegir la de
            los ejes) y, si no detecta, el mensaje da un DIAGNÓSTICO (líneas vert/horiz/incl, ejes X/Y,
            extensión). Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.49.0 IMPORTAR EJES DESDE CAD (DXF) — herramienta OPCIONAL (pedido del usuario: "importar los
            ejes de un archivo CAD, acá usa ejes inclinados si fuera necesario"). EVALUACIÓN: el .dwg es
            BINARIO/cerrado (no hay ezdxf ni convertidor ODA en el entorno; no se puede leer ni en el
            navegador ni en Python puro) → el usuario exporta a DXF (texto: DXFOUT / Guardar como DXF).
            Parser AUTOCONTENIDO sin deps (offline, como el resaltador): parseDxfEntities lee entidades
            LINE y LWPOLYLINE (pares código/valor); extraerEjesDeDxf clasifica por ángulo: líneas
            ortogonales LARGAS → clusters → luces X/Y; líneas inclinadas largas → EJES INCLINADOS (por
            sus 2 extremos, en coords de planta). Auto-detecta la unidad por el tamaño del dibujo (mm/cm/m)
            y deja elegir CAPA + UNIDAD (selectores que re-extraen). Rellena espaciamientosX/Y +
            gridParams.ejesInclinados → vista previa (ortogonal + inclinado ámbar). En el paso Crear
            grilla, <details> "📐 Importar ejes desde CAD (DXF)". handleImportDxf/aplicarDxf. Solo
            frontend, sin nuevas deps (servidor sigue v1.28.0, NO reiniciar). Validado: parser+heurística
            en Node (grilla mm → lucesX[5,4]/lucesY[4,4] + 1 inclinado (0,0)-(9,8)) + build + UI en vivo.
  - v3.48.0 GRILLA DESDE IMAGEN: SOLO ORTOGONAL (decisión del usuario: "los ejes inclinados están
            causando problemas para la IA, mantén la herramienta que NO sean ejes inclinados"). Se
            REVIRTIÓ v3.47.1: el prompt de visión ya NO pide ejesInclinados y el handler ya no los
            rellena; en su lugar el prompt INSTRUYE a tratar la grilla como ORTOGONAL (si hay ligera
            inclinación, tomar el lado izquierdo/inferior de referencia y solo mencionarla en notas) →
            la IA deja de confundirse. El tool MANUAL de ejes inclinados (v3.42.0) SE MANTIENE intacto:
            si hay un eje inclinado, el usuario lo agrega a mano. + Se documentó todo lo reciente en
            DOCUMENTACION_PROYECTO.md. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.47.1 GRILLA DESDE IMAGEN ahora también COLOCA EJES INCLINADOS (pedido del usuario: "la IA indica
            que hay una inclinación, eso sería un eje inclinado; cuando haya un eje inclinado, podría
            ponerlo"). Conecta las dos funciones (v3.47.0 imagen + v3.42.0 ejes inclinados): VISION_GRID_
            PROMPT ahora pide también "ejesInclinados":[{id,x1,y1,x2,y2}] (los ejes NO paralelos, por sus
            2 extremos, con origen en el cruce 1-A, X hacia números, Y hacia letras) y handleDetectGrid
            FromImage rellena gridParams.ejesInclinados (filtra inválidos y P1==P2) → aparecen en la tabla
            de ejes inclinados + ÁMBAR en la vista previa + en el script (General Cartesian). El mensaje
            avisa cuántos inclinados se colocaron. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.47.0 GRILLA DESDE IMAGEN (opcional, IA visión) — pedido del usuario: "crear grillas a partir de
            una imagen, una herramienta que reconozca los ejes; evalúa cómo". EVALUACIÓN: la parte
            determinista (construir la grilla) ya es sólida; leer cotas/ejes de un raster CAD arbitrario
            de forma determinista es frágil (necesitaría OpenCV+OCR+detección de líneas/círculos, nuevas
            deps, poco robusto). Se eligió IA VISIÓN (encaja con "la IA hace lo mínimo"): el modelo LEE
            las luces de la imagen y rellena el formulario; el usuario REVISA antes de ejecutar. En el
            paso "Crear grilla" hay un <details> "📷 Detectar ejes desde una imagen": sube foto/captura →
            handleDetectGridFromImage manda la imagen al motor activo (Gemini u OpenAI, ambos visión,
            directo del navegador; Anthropic se omite, va por servidor) con VISION_GRID_PROMPT que pide
            JSON {lucesX,lucesY,ejesX,ejesY,confianza,notas} (centro a centro, ignorar cotas de borde) →
            rellena espaciamientosX/Y → la vista previa SvgPlanta se actualiza. visionGemini (inline_data)
            / visionOpenAI (image_url). Llave/modelo del proveedor activo. Solo frontend, sin nuevas deps
            (servidor sigue v1.28.0, NO reiniciar). Validado: build + UI + wiring; la precisión del OCR
            depende del modelo/imagen y EXIGE revisión del usuario (por eso rellena el form, no ejecuta).
  - v3.46.0 PASO "END LENGTH OFFSET" IMPLEMENTADO + VALIDADO EN VIVO (pedido del usuario: "asigna el
            end length offset a todas las vigas y columnas"). Replica el diálogo Frame Assignment - End
            Length Offsets: modo Automático (desde conectividad) o Definir longitudes (End-I/J) + factor
            de zona rígida (0.5 por defecto) + filtro vigas/columnas/ambas. HALLAZGO validado en vivo
            (ETABS 22): cFrameObj.SetEndLengthOffset con AutoOffset=True NO guarda el factor de zona
            rígida (RigidFact queda 0); SÍ lo guarda con AutoOffset=False. Por eso el modo AUTO se asigna
            por DATABASE TABLE "Frame Assignments - End Length Offsets" (OffsetOpt="Auto", RigidFact=0.5,
            OffsetI/J los calcula ETABS) y el modo MANUAL por la API. Clasifica viga/columna con
            FrameObj.GetDesignOrientation (1=Columna, 2=Viga). Como en el GUI, primero SELECCIONA los
            frames. buildEndOffsetBody + form + handlers; step endoffset implementado:true. Validado:
            tabla → RigidFact=0.5 con OffsetOpt=Auto (apply ints [0,0,0,0]); en modelo real 204 frames.
            Solo frontend (servidor sigue v1.28.0, NO reiniciar). PENDIENTE: Release → Verif sistema →
            Verif irregularidades → 2do análisis.
  - v3.45.1 FIX "Error ejecutando" al asignar diafragma (reportado por el usuario). CAUSA RAÍZ
            (validada en vivo contra el modelo real): cDiaphragm.SetDiaphragm devuelve 1 (ERROR) si el
            nombre YA existe — NO actualiza. El modelo del usuario ya tenía "D1-rigido" (de un intento
            previo) + el "D1" que ETABS auto-crea de las losas, así que verificar_retorno reventaba. El
            test en modelo nuevo nunca lo vio (el nombre no preexistía). FIX: buildDiaphragmBody ahora es
            IDEMPOTENTE — crea el diafragma solo si falta (Diaphragm.GetNameList); si existe con la misma
            rigidez lo reutiliza, y si difiere lo borra (Diaphragm.Delete) y lo recrea. Validado en vivo
            sobre el modelo real (PID del usuario): reutilizó D1-rigido y asignó 80/80 nudos en 4 pisos,
            diagnóstico TODO OK. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.45.0 DIAFRAGMA por PISOS + DIAGNÓSTICO (pedido del usuario: "agrega para que se pueda agregar a
            determinados pisos, o todos los pisos; que se pueda saber si hay un piso que no tiene
            diafragma rígido; recuerda que no se aplica diafragma rígido a la base"). buildDiaphragmBody
            ahora trabaja POR PISO (Story.GetNameList/GetElevation + PointObj.GetNameListOnStory):
            alcance "todos" o "especificos" (lista de nombres "Story1, Story3"); excluye apoyos
            (GetRestraint) → la base nunca lleva diafragma; reporta nudos asignados por piso. NUEVO
            buildDiaphragmCheckBody (diagnóstico solo lectura, botón "🔎 Verificar diafragmas por piso"):
            por cada piso cuenta nudos con diafragma RÍGIDO (GetDiaphragm opt=3 + Diaphragm.GetDiaphragm
            SemiRigid=False) y avisa de pisos SIN diafragma / PARCIALES. handleCheckDiafragma usa
            executeCode SIN stepId (no marca el paso). Form: + "Aplicar a" (todos/específicos) + input de
            pisos + botón de verificación. Helpers Python compartidos en DIAFRAGMA_HELPERS. Validado en
            vivo ETABS 22 (modelo 3 pisos): asignó a Story1+Story3 (8 nudos), diagnóstico marcó Story2 como
            FALTA y Story1/Story3 OK. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.44.0 PASO "ASIGNAR DIAFRAGMA RÍGIDO" IMPLEMENTADO + VALIDADO EN VIVO (pedido del usuario:
            "ahora define y asigna el diafragma rígido, y luego lo asignas por punto a toda la planta").
            buildDiaphragmBody: 1) DEFINE el diafragma con cDiaphragm.SetDiaphragm(nombre, SemiRigid)
            (SemiRigid=False → rígido); 2) como en el GUI (Assign > Joint > Diaphragms) SELECCIONA los
            nudos (SelectObj.ClearSelection + PointObj.SetSelected) y 3) lo ASIGNA POR PUNTO con
            cPointObj.SetDiaphragm(nudo, 3, nombre) — eDiaphragmOption.DefinedDiaphragm=3 — a TODOS los
            nudos de cada planta SOBRE la base (la base, cota mínima/restringida, se excluye). ETABS
            agrupa por elevación → un diafragma rígido independiente por piso con un solo nombre. Form:
            nombre (default "D1-rigido") + rigidez Rígido/Semi-rígido. Step diafragma implementado:true
            + formularioPorPaso. Validado en vivo ETABS 22 (2026-06-20, modelo 2 pisos): SetDiaphragm
            ret 0, asignó 8/8 nudos sobre base, GetDiaphragm releyó [3,'D1-rigido']. Solo frontend
            (servidor sigue v1.28.0, NO reiniciar). PENDIENTE: End offset → Release → Verif sistema →
            Verif irregularidades → 2do análisis.
  - v3.43.0 AUTOMESH REAL (cookie cut / rectangular) — CORRIGE v3.30.0 (pedido del usuario: "el
            automesh tiene errores, que se haga el automesh de esa manera [diálogos Floor/Wall Auto
            Mesh]; primero se tiene q seleccionar los elementos"). HALLAZGO NUEVO validado en vivo
            (ETABS 22, 2026-06-20): aunque cAreaObj NO tiene SetAutoMesh (confirmado: 71 métodos, solo
            SetEdgeConstraint), las opciones de auto-mallado SÍ se asignan por DATABASE TABLES (como
            grillas/espectro). v3.30.0 se quedó corto usando solo SetEdgeConstraint (de ahí los
            "errores"). Ahora buildAutomeshBody, como en el GUI, PRIMERO SELECCIONA (SelectObj.
            ClearSelection + AreaObj.SetSelected) y luego asigna: LOSAS → tabla "Area Assignments -
            Floor Auto Mesh Options" MeshOption="Auto Cookie Cut" + AtBeams/AtWalls=Yes, AtGrids según
            checkbox, Submesh=Yes, SubmeshSize=tamaño máx.; MUROS → "Area Assignments - Wall Auto Mesh
            Options" MeshOption="Auto Rectangular Mesh" + Restraints=Yes, y el tamaño máx. GLOBAL en
            "Analysis Options - Automatic Rectangular Mesh Options for Walls" (MaxMeshSize). Strings y
            campos verificados leyendo de vuelta (Floor: Auto Cookie Cut/0.7; Wall: Auto Rectangular;
            Global: 0.7; ApplyEditedTables ints [0,0,0,0]). Form: + tamaño máx. (m, default 0.7) +
            checkbox "mallar en grillas visibles". Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.42.1 FIX layout: la tabla de ejes inclinados se DESBORDABA sobre la vista previa (los inputs
            de un grid con columnas 1fr no encogen por debajo de su ancho intrínseco ~size=20 →
            "grid blowout"). Se añadió w-full + min-w-0 a cada input de la fila y min-w-0 al
            contenedor → las columnas encogen y la fila queda dentro de la columna del formulario.
            Solo frontend (servidor sigue v1.28.0).
  - v3.42.0 GRILLA CON EJES INCLINADOS + VISTA PREVIA DEL EJE (pedido del usuario: "para las grillas
            implementa una manera de que se coloque un eje inclinado (ya se documentó) y también una
            vista previa del eje antes de ejecutarlo"). EJE INCLINADO = línea "General (Cartesian)" por
            2 puntos (regla 32 de la doc, ya validada): se agrega una fila a la tabla "Grid Definitions
            - Grid Lines" con LineType "General (Cartesian)" y X1,Y1,X2,Y2 = extremos (m), Ordinate/Angle
            vacíos. gridParams.ejesInclinados = [{id,x1,y1,x2,y2,bubble}]; helpers addEjeInclinado/
            setEjeInclinado/removeEjeInclinado. buildNonUniformGridBody acepta ejesInclinados → emite
            EJES_INC + fila_general() (filtra inválidos: 4 coords numéricas y P1≠P2). De paso se arregló
            un bug latente del encuadre (usaba ALTURA_PRIMER_PISO/ALTURA_TIPICA, ya inexistentes →
            NameError silenciado): ahora tope_z=sum(ALTURAS) y los puntos temporales abarcan también los
            extremos inclinados. FORM: tabla editable (ID/X1/Y1/X2/Y2 + quitar) con "+ Agregar eje" en el
            paso Grilla. VISTA PREVIA: SvgPlanta gana prop `ejes` → dibuja cada inclinado en ÁMBAR (línea
            + nodos + burbuja con su ID) y AMPLÍA el dominio de escala con sus extremos para no recortar;
            el resumen del paso cuenta los ejes. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.41.0 TERMINAL CONTRAÍBLE + TOGGLE DE BARRA LATERAL MÁS CLARO (pedido del usuario: "la barra
            lateral a la derecha y el terminal que se pueda contraer"). TERMINAL: estado terminalOpen
            (persistido en localStorage como sidebarOpen). El encabezado del Terminal es ahora un botón
            con chevron (ChevronDown abierto / ChevronUp contraído) que alterna; al contraerlo el panel
            pasa de h-56 a h-auto (solo el encabezado) → el editor gana todo ese alto; los botones de
            acción (Preflight, etc.) siguen visibles y, contraído, se muestra la 1ª línea de la salida
            como preview. BARRA LATERAL: ya era contraíble (sidebarOpen, v3.28.0); se cambiaron los
            caracteres "›/‹" por iconos ChevronRight/ChevronLeft para que el control se vea claro.
            Solo frontend (servidor sigue v1.28.0, NO reiniciar). Iconos Chevron* de lucide-react.
  - v3.40.0 EDITOR "CÓDIGO + TERMINAL" CON RESALTADO DE SINTAXIS + COPIAR (pedido del usuario:
            "que tenga colores, que reconozca los tags/etiquetas, que se pueda copiar código;
            hay unos botones, no sé si son útiles"). RESALTADO AUTOCONTENIDO sin dependencias ni
            CDN (filosofía offline-safe de la app, como las fuentes empaquetadas): highlightPython
            tokeniza en UNA pasada de regex (comentarios, cadenas triples/con prefijo r/f/b,
            números, decoradores, palabras clave, constantes True/False/None, builtins/self y
            llamadas a función) y SIEMPRE escapa HTML. Técnica de overlay (como react-simple-code-
            editor, pero sin la lib): <pre> coloreado detrás (define el alto) + <textarea>
            transparente encima (texto invisible, solo cursor cian) que captura la edición; ambos
            comparten fuente/tamaño/interlineado/padding/ajuste de línea → el cursor cae exacto
            sobre el código. Tokens de color en index.css (paleta Tokyo Night, azul de marca). Tab
            inserta 4 espacios (handleEditorKeyDown). COPIAR: botón flotante "Copiar" arriba-derecha
            del editor (handleCopyCode → portapapeles). BOTONES del terminal: ahora cada uno tiene
            tooltip (title) que explica para qué sirve (Preflight, Guardar .py, Auto-reparar,
            Guardar como flujo, Reparar con IA, Copiar informe). Solo frontend (servidor sigue
            v1.28.0, NO reiniciar). Dep nueva: ninguna. Icono Copy de lucide-react.
  - v3.39.0 NUEVA MEMORIA: DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN (ACI 318-19 18.4.2.2 / E.060 21.4.4.2)
            (pedido del usuario: "ahora esto como memoria de cálculo"). 5º documento de la pestaña
            Memoria. Reproduce fiel la hoja: 6 momentos de diseño (M1,M2 caras −; M3 centro +;
            M4=M1/3, M5=M2/3 mínimos + en caras; M6=máx(M1,M2)/5 mínimo en cualquier sección) y el As
            de cada uno con la misma flexión (a, As,req) + As,mín = mín(máx(0.8√f'c/fy·bd, 14/fy·bd),
            4/3·As,req) → As = máx(As,req, As,mín). calcDistribucion + buildMemoriaDistribucion (.tex
            con tabular) + SvgDistribRefuerzo (envolvente de momentos con M1..M6 y la distribución del
            acero As1..As6, eje verde + hatch azul, modo 'M'/'As'). renderHojaDistribucion = 2 páginas
            A4 (P1 momentos + envolvente, P2 tabla de 6 secciones + distribución del acero). Estado
            distribParams + setDist; memoDoc/memoFile cubren 'distrib'. Validado vs la hoja (b=40,d=64,
            f'c=280: a 10.20/9.27/4.77/3.21/2.93/1.90; As 23.11/21.02/10.81/8.53/8.53/5.76; As,mín=8.53
            salvo M6=5.76 por el tope 4/3·As,req). Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.38.0 NUEVA MEMORIA: DISEÑO DE FLEXIÓN DE VIGAS (ACI 318-19) (pedido del usuario: "ahora realiza
            esa memoria de cálculo"). 4º documento de la pestaña Memoria (Materiales | Espectro |
            Longitud de desarrollo | Flexión de vigas). Reproduce fiel la hoja Mathcad: A) cálculo de
            refuerzo (a, As, ρ), B) verificación del acero máximo (β1, c, εt, εyt, εs,min, φ por la
            transición R21.2.2), acero máximo E.060 10.3.4 (ρb, 0.75ρb·bd), E.060 10.3.5 (cmax=3d/7,
            amax, Asmax), ACI 18.6.3.1 (0.025·bd), tabla de %ρb, C) acero mínimo (mín(máx(0.8√f'c/fy·bd,
            14/fy·bd), 4/3·As)), D) temperatura (0.0018·b·hv), E) acero necesario (cases), F) acero a
            colocar (Av1 del catálogo BARRAS_ACERO con áreas comerciales + Nv + nº de varillas).
            calcFlexion + buildMemoriaFlexion (.tex) + 4 SVG: SvgFlexionBloque (bloque 0.85f'c + fuerzas),
            SvgDeformaciones (triángulo 0.003/c/d-c/εt), SvgPhiEt (curva φ–εt Fig. R21.2.2b) y
            SvgSeccionVigaBarras (sección con las varillas). renderHojaFlexion = 5 páginas A4. Estado
            flexionParams + setFlx; memoDoc/memoFile cubren 'flexion'. Validado numéricamente vs la hoja
            (b=10,h=25,Mu=4723.25: a=0.11, As=0.06, ρ=0.0003, β1=0.85, c=0.12, εt=0.5057, φ=0.9, ρb=0.0283,
            Asmax 4.46/4.34/5.25, Asmin=0.08, Astem=0.45, Ase=0.45). Solo frontend (servidor sigue v1.28.0).
  - v3.37.0 FIGURAS de la memoria de LONGITUD DE DESARROLLO como SVG VECTORIAL (pedido del usuario:
            "¿y las imágenes? ¿hay manera de replicarlo en la memoria?"). En vez de imágenes raster
            (frágiles), se dibujan deterministas con SVG (nítidas en PDF, sin archivos): SvgGanchoDetalle
            (detalle geométrico del doblez a 90° y a 180° con cotas db/D/12db/4db-mín-65/L),
            SvgAnclajeGancho (columna+viga, sección crítica en la cara del apoyo, gancho 90/180 y cota
            ℓdh) y SvgVigaConcepto (figuras a "sin desarrollo → falla" y b "varillas prolongadas ℓd").
            Helpers _COL/_flecha/_dbTxt. renderHojaDesarrollo pasó de 2 a 3 páginas A4: P1 datos+cálculos,
            P2 anclaje (concepto a/b + ℓdh + figura del gancho en el apoyo), P3 ganchos (fórmulas +
            los 2 detalles de doblez sobre sus tablas). El PDF (window.print) incluye las figuras; el
            .tex sigue con fórmulas+tablas (sin TikZ). Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.36.0 NUEVA MEMORIA: LONGITUD DE DESARROLLO A TRACCIÓN (pedido del usuario: "crear una nueva
            hoja de cálculo sobre LONGITUD DE DESARROLLO A TRACCIÓN, inclúyela en el proyecto").
            Reproduce fiel la hoja Mathcad del usuario (E.060 / ACI 318-19) como 3er documento de la
            pestaña Memoria (selector Materiales | Espectro | Longitud de desarrollo). Nuevo:
            BARRAS_ACERO (catálogo db por etiqueta 6mm..1 3/8"), calcDesarrollo (cb=r+dt+db/2;
            Atr=2·πdt²/4; Ktr=Atr·fy/(105·s·n); ld simplificada por tramo db≤1.91→8.2 / db>1.91→6.6
            de la Tabla 12.1 E.060; ld general 12-1 = fy·ψt·ψe·ψs·ψg/(3.5·λ·√f'c·min((cb+Ktr)/db,2.5))·db;
            ldh gancho = 0.075·ψe·fy·db/(λ·√f'c); ganchos 90°=16db / 180°=8db + tablas en mm con
            extensión mín. 65mm en 180°) y buildMemoriaDesarrollo (.tex standalone con align+cases+
            tabular). renderHojaDesarrollo = 2 páginas A4 (datos+ld / ganchos+2 tablas), KaTeX, datos
            en caja azul .mem-inbox estilo Mathcad. Estado desarrolloParams + setDes; memoDoc/memoFile
            cubren 'desarrollo'. Validado numéricamente vs la hoja (db=1": cb=6.223, Atr=1.425, Ktr=1.9,
            ld=125.575, ld gen=94.719, ldh=47.815, L90=40.64, L180=20.32). Solo frontend (servidor
            sigue v1.28.0, NO reiniciar).
  - v3.35.0 MEMORIAS DE CÁLCULO TODAS EN FORMATO A4 (pedido del usuario: "las memorias deben ser en
            formato A4; la del espectro de respuesta no está en A4"). La memoria del ESPECTRO metía
            TODO (factores + 2 tablas de irregularidades + resumen + 2 gráficos + tabla de 48
            periodos) dentro de UNA sola .hoja-a4 con min-height:297mm → el div crecía y se volvía
            una hoja altísima, NO una A4. Ahora renderHojaEspectro devuelve PÁGINAS A4 reales:
            Página 1 (factores + irregularidades) y Página 2 (resumen + gráficos + tabla T-Sa), cada
            una su propia .hoja-a4 con encabezado y pie "Página X de Y". Ambas memorias se envuelven
            en <div id="memoria-hoja" className="memoria-pages"> (flex column con gap) que apila las
            páginas en pantalla como un documento multipágina; materiales (1 página) usa el MISMO
            contenedor. CSS @media print paginado: cada .hoja-a4 hija de #memoria-hoja con
            page-break-after:always (la última auto) → al "Exportar a PDF" cada hoja sale en una A4
            física, con formulas vectoriales. Solo frontend (servidor sigue v1.28.0, NO reiniciar).
  - v3.34.1 COLOR DE MARCA — Ingeniería Fácil (ingenieriafacil.com): se extrajo la paleta del HTML/
            CSS real de la web del usuario → AZUL (#1d4ed8/#0284c7) primario + ÁMBAR (#f59e0b) acento
            (los rojos eran error, no marca). Aplicación GLOBAL sin tocar clases: en index.css @theme
            se REMAPEÓ la escala 'cyan' de Tailwind (el acento primario de toda la app) a los valores
            'blue' de Tailwind (blue-700=#1d4ed8 = el azul de la marca) → todo el cian se vuelve azul
            de marca. El ámbar de la app ya coincidía con el acento; el verde se reserva a éxito/done.
            Gradientes de identidad (logo, título, indicador de pestaña activa) cambiados a AZUL→
            ÁMBAR; fondo raíz a glows azul+ámbar; ::selection y scrollbar al azul; hexes de cian
            hardcodeados en los SVG (grilla 3D/planta/elevación, gráfico del espectro: #22d3ee/#67e8f9/
            #7dd3fc/#38bdf8/rgba cian) reemplazados por azul (blue-300/400/500). Solo estilos.
  - v3.34.0 MODERNIZACIÓN VISUAL GLOBAL (pedido del usuario: "moderniza todo lo visible, muy
            profesional y fino; objetivo: promocionar un curso"). Pase global de alto impacto y bajo
            riesgo: (1) tipografía premium — Inter (UI) + JetBrains Mono (código) vía index.html +
            tokens Tailwind v4 @theme (--font-sans/--font-mono) en index.css, con font-smoothing y
            tracking fino; (2) index.css: scrollbars finos/discretos, color de selección cian,
            color-scheme dark; (3) fondo raíz con PROFUNDIDAD (3 radial-gradients sutiles cian/
            esmeralda/índigo sobre casi-negro #060709); (4) encabezado tipo GLASS (bg translúcido +
            backdrop-blur-xl + borde sutil); (5) barra de pestañas refactorizada a map con indicador
            inferior con GLOW (gradiente cian→esmeralda) y hover sutil, tipografía más fina; (6)
            tokens compartidos refinados (inputCls/lblCls/selCls/cardCls): bordes/anillos de foco
            más finos, sombras suaves en tarjetas — se propaga a TODA la app. Solo frontend/estilos
            (sin cambios de lógica ni de servidor, sigue v1.28.0).
  - v3.33.0 EXPORTAR EL ESPECTRO A EXCEL con FÓRMULAS VIVAS + gráfico (pedido del usuario, modelado
            en su hoja ESPECTRO DE RESPUESTA SISMICA - 2026.xlsx). Botón "📊 Exportar a Excel" en la
            pestaña El Espectro de Diseño → POST /espectro/excel (servidor v1.28.0) con los
            parámetros de calcEspectroDiseno (z,u,s,tp,tl,g, R0/Ia/Ip por dirección, periodos) → el
            servidor genera el .xlsx con openpyxl (espectro_excel.build_espectro_xlsx) y el frontend
            lo descarga. La hoja es PRESENTABLE (título, parámetros como ENTRADAS en azul, tabla de
            48 periodos) y TODO por FÓRMULA viva: R=R0·Ia·Ip, factor C E.030 con rama corta
            (=IF(T<0.2·Tp,1+7.5·T/Tp,...)) y Sa=Z·U·C·S·g/R; gráfico Sa–T (X azul/Y ámbar) + hoja
            "DATOS TXT" para el From File. Cambiar un parámetro en Excel recalcula todo. VALIDADO en
            EXCEL REAL (recalc por COM): R por fórmula OK, Sa por fórmula = cálculo E.030 (dif 0.0),
            1 gráfico, 0 errores. openpyxl instalado en osenv312. SUBE EXPECTED_SERVER_VERSION a
            1.28.0 → REINICIAR EL SERVIDOR.
  - v3.32.0 GRILLA: ALTURA POR PISO (estilo Tekla), se quitó "Altura típica" + "Altura 1er piso"
            (pedido del usuario: "en la grilla que no haya altura típica, la altura de pisos que se
            defina por espacios, ej. 4 5 5; igual a Tekla, con n*h"). gridParams ahora tiene
            `alturasPisos` (string, ej. "3.5, 3, 3, 3") en vez de numeroPisos/alturaTipica/
            alturaPrimerPiso. Nuevo parser parseAlturasPisos: "4 2*5" → [4,5,5] (multiplicador n*h o
            n x h, separadores espacio/coma; abajo→arriba, 1ª = primer piso) + nivelesDeAlturas
            (alturas→cotas Z acumuladas). buildNonUniformGridBody acepta `alturasPiso` (lista
            explícita) → el array `alturas` de Story.SetStories_2 es esa lista (alturas arbitrarias
            por piso; antes solo 1er+típica). El nº de pisos = nº de alturas. El form muestra un solo
            campo con resumen en vivo (pisos, alturas, total, cotas Z). nivelesPreview y el resumen
            usan la lista → el preview de elevación y OpenSees toman las alturas reales. Compat:
            buildNonUniformGridBody sigue aceptando alturaPiso/alturaTipica para la Biblioteca
            (nuGridParams sin cambios). gridParams NO se persiste → sin migración. Solo frontend.
  - v3.31.2 UN SOLO PYTHON 3.12 (decisión del usuario, tras el fix v3.31.1): se UNIFICÓ todo en el
            venv 'osenv312' (Python 3.12) que ya tenía openseespy; se le instalaron fastapi 0.137.1
            + uvicorn 0.49.0 + comtypes 1.4.16 (pydantic viene con fastapi). Razón: openseespy SOLO
            corre en 3.12 (binario), y todo lo demás (fastapi/uvicorn/comtypes+ETABS) también
            funciona en 3.12 (comtypes+ETABS verificado en vivo) → 3.12 es el denominador común. Ya
            NO hay dos Pythons → se acaba la confusión del PATH. INICIAR TODO.bat apunta al python de
            osenv312. OpenSees SIGUE por subproceso (mismo intérprete, aislado). El guard de
            etabs_server.py apunta ahora a osenv312. Servidor v1.27.2. SUBE EXPECTED_SERVER_VERSION a
            1.27.2. Validado: imports OK en osenv312; servidor arranca y responde; ETABS y OpenSees
            por el nuevo entorno.
  - v3.31.1 FIX "No se pudo conectar al servidor": el servidor se caía al arrancar con
            ModuleNotFoundError: fastapi. CAUSA RAÍZ: el comando `python` resolvía a Python 3.12
            (instalado por winget para openseespy, quedó PRIMERO en el PATH) que NO tiene fastapi;
            el servidor necesita Python 3.13 (único con fastapi/uvicorn/comtypes). INICIAR TODO.bat
            ahora apunta al Python 3.13 EXPLÍCITO (ruta completa, con respaldo `py -3.13`) en vez de
            `python` a secas. etabs_server.py gana un GUARD: si se corre con un Python sin fastapi,
            imprime un mensaje claro (qué Python, qué hacer) en vez de un traceback. Servidor v1.27.1
            (solo el guard + versión; sin cambios de API). SUBE EXPECTED_SERVER_VERSION a 1.27.1.
  - v3.31.0 ZOOM + PAN en el diagrama del flujo + BOTONES a la izquierda (pedido del usuario).
            El lienzo (1820x640) va dentro de un VIEWPORT con overflow-hidden y se transforma con
            translate(flowPan)+scale(flowZoom), origin 0,0. Rueda del ratón = zoom centrado en el
            cursor (zoomEnPunto: pan' = m - (m-pan)*k, clamp 0.35–2.5); arrastrar el fondo = pan
            (umbral 4px; flowJustDragged suprime el clic del nodo tras arrastrar). Controles +/−/⤢
            (reset) abajo a la derecha + indicador de % abajo a la izquierda. Estado flowZoom/
            flowPan/flowDragging + refs flowViewportRef/flowDragRef/flowJustDragged. Los 3 botones
            (Diagnosticar modelo / Leer modelo abierto / Reiniciar progreso) se movieron a la
            IZQUIERDA del encabezado; la leyenda quedó a la derecha. El contenedor pasó de
            overflow-auto a flex-col con el viewport flex-grow. Solo frontend.
  - v3.30.0 PASO "AUTOMESH LOSAS Y MUROS" IMPLEMENTADO + VALIDADO EN VIVO (pedido del usuario:
            "después de Asignar apoyos se debe habilitar Automesh losas y muros, luego Correr 1er
            análisis"). HALLAZGO (no reinvestigar): la API de ETABS 22 NO expone un SetAutoMesh por
            objeto — se confirmó interrogando el COM real: cAreaObj NO tiene NINGÚN método con
            'mesh'. ETABS auto-malla pisos/muros AL ANALIZAR. El control de mallado que SÍ expone es
            el AUTO EDGE CONSTRAINT (cAreaObj.SetEdgeConstraint), compatibilidad de mallas en bordes.
            Así que automesh implementado:true activa SetEdgeConstraint(area, True) en todas las
            áreas (form: filtro todas/losas/muros vía GetDesignOrientation). VALIDADO EN VIVO
            (instancia nueva, losa+muro): SetEdgeConstraint ret=0, EdgeConstraint quedó True. OJO
            (corregido por la validación): eAreaDesignOrientation = 1 Wall (muro) / 2 Floor (losa) —
            estaba al revés en el primer borrador. Al activarse, el 1er análisis (analizar) AHORA
            depende de automesh real → cadena apoyos → automesh → 1er análisis. Servidor sin cambios.
  - v3.29.1 "LEER MODELO ABIERTO" ahora ACTUALIZA TODO (pedido del usuario: "cuando leo el modelo,
            los flujos deben actualizarse según si fue definido o no; también en el Modelador debe
            traerse la info del modelo"). handleReadModel se consolidó: (1) llama handleDiagnosticar(
            {abrirModal:false}) → auto-marca los pasos del flujo según lo definido en el modelo real
            (/etabs/diagnostico, g.pasos) + materiales/secciones detectadas, SIN abrir el modal;
            (2) llama handleLeerModeloGeo() → trae frames/areas/grilla al MODELADOR (/etabs/modelo-
            geometria, fuenteGrilla='real'). handleDiagnosticar ahora acepta {abrirModal} y retorna
            éxito (el botón "Diagnosticar modelo" lo sigue llamando con evento → abrirModal=true →
            modal abre igual). Validado EN VIVO: reset → "Leer modelo abierto" marcó 20 pasos del
            modelo real y el Modelador trajo 124 vigas; "Diagnosticar" sigue abriendo su modal. Solo
            frontend.
  - v3.29.0 PASO "MASS SOURCE" IMPLEMENTADO (pedido del usuario: "después de definir patrones de
            carga, que se active Mass Source y luego Espectro de diseño"). masssource pasa a
            implementado:true con form + handlers + script (buildMassSourceBody). El script usa la
            MISMA llamada validada del paso Espectro: PropMaterial.SetMassSource_1(IncludeElements,
            IncludeAddedMass=False, IncludeLoads=True, N, [CM,CV], [factorCM,factorCV]) — firma
            oficial verificada vía buscar_api_etabs. Los factores CM/CV se comparten con el espectro
            (espectroParams.masaCM/masaCV); el form agrega patrón de cada uno + opción "incluir peso
            propio de elementos" (default off, para no doblar masa si CM ya trae el peso propio).
            Al activarse, Espectro AHORA depende de masssource (real, ya no placeholder) → cadena
            Patrones → Mass Source → Espectro. Solo frontend.
  - v3.28.3 TREN DE CARGAS en CADENA LINEAL "uno tras otro" (pedido del usuario: "en la parte
            inferior que sigan este orden, uno tras otro"): Patrones → Mass Source → Espectro →
            Casos → Combinaciones, en una sola fila horizontal (y=500, x=10/235/465/695/925) con
            deps consecutivas. Cambios: 'Definir casos de carga' ahora se AUTO-completa al hacer el
            ESPECTRO (antes con Patrones), acorde al nuevo orden (los casos Modal/Sismo salen del
            espectro). stepDisponible ahora atraviesa los placeholders de forma TRANSITIVA
            (reqCumplido recursivo): una dep no implementada no bloquea por sí misma pero SÍ exige
            sus prerequisitos reales — así Espectro queda tras Patrones aunque Mass Source siga sin
            implementar. Para no sobre-restringir el 1er análisis, las deps de Automesh pasaron de
            las 4 losas a ['apoyos'] (el modelo armado, que el análisis ya exige). El mensaje
            "Primero completa…" también resuelve el requisito real a través de placeholders. Solo
            frontend.
  - v3.28.2 MATERIALES antes de SECCIONES + material por defecto (pedido del usuario: "la
            definición de secciones que se haga DESPUÉS de definir el acero, y ese acero y
            concreto definido que sea usado POR DEFECTO en la definición de secciones").
            (1) Deps: 'acero' ahora depende de 'material' (concreto→acero, cadena en el grupo
            Materiales) y las 6 secciones (viga/columna/losa1D/losa2D/maciza/muro) dependen de
            'acero' (antes de 'material'): quedan disponibles SOLO tras definir concreto Y acero.
            (2) Dos useEffect: el concreto definido (matParams.nombre) se propaga como material de
            TODAS las secciones, y el acero definido (aceroParams.nombre) como matRefuerzo de
            viga/columna. Así las secciones traen por defecto el concreto/acero que definiste (el
            usuario aún puede cambiarlo). Efectos colocados DESPUÉS de declarar los states (TDZ).
            Solo frontend.
  - v3.28.1 PULIDO VISUAL del diagrama de flujo (pedido del usuario): se BORRARON las 5 flechas
            rojas cruzadas patrones->cargar* y se reemplazaron por UNA sola flecha "bus" ÁMBAR
            (busPath: patrones -> grupo Asignar cargas; punteada si patrones no está hecho). Las
            5 deps siguen en WORKFLOW_STEPS (lógica intacta), solo se omiten del dibujo. Aristas
            más finas (1.7px, linecap redondo, punteado 4·6), markers de flecha más pequeños y
            limpios (verde hecho / gris pendiente / ámbar bus). Cajas de paso con gradiente sutil
            + ring + hover suave (border 1px en vez de 2px). Grupos punteados redondeados con
            tinte (Materiales / Asignar cargas en ÁMBAR / Asignaciones). Leyenda con el bus.
            Solo frontend.
  - v3.28.0 FLUJO DE TRABAJO REESTRUCTURADO según el esquema del usuario + BARRA LATERAL
            COLAPSABLE. (1) WORKFLOW_STEPS reorganizado: MATERIALES → [DEFINIR→DIBUJAR→
            CARGAR/ASIGNAR]×6 → AUTOMESH + {DIAFRAGMA RÍGIDO, END LENGTH OFFSET, RELEASE} →
            1ER ANÁLISIS → {VERIFICAR SISTEMA, VERIFICAR IRREGULARIDADES} → 2DO ANÁLISIS;
            tren de cargas (PATRONES + MASS SOURCE + ESPECTRO → CASOS → COMBINACIONES). Se
            mantiene 'grid' como prerequisito (decisión del usuario). Pasos NUEVOS sin script
            aún (automesh, diafragma, endoffset, release, masssource, verifsistema, verifirreg,
            analizar2) van con implementado:false ("Próximamente") y NO bloquean: stepDisponible
            ignora deps todavía no implementadas (solo bloquean cuando se implementen en vivo,
            una por una). Canvas ensanchado a 1820×640 + cajas de agrupación punteadas
            (Materiales / Asignar cargas / Asignaciones). (2) Panel lateral derecho (IA/
            Biblioteca) COLAPSABLE: botón › para ocultarlo (gana área de trabajo) + riel
            vertical ‹ para reabrirlo; estado sidebarOpen persistido en localStorage. PENDIENTE
            (vamos en vivo): implementar+validar contra ETABS real el script de cada paso nuevo.
  - v3.27.0 OpenSees AHORA MODELA LA LOSA como elemento MEMBRANA (pedido del usuario tras
            preguntar "¿OpenSees no puede definir un elemento losa?" → eligió "membrana +
            diafragma rígido"). Aclaración técnica: OpenSees SÍ puede (ShellMITC4, ShellDKGQ,
            etc.); el motor solo no lo usaba. Ahora buildOpenSeesSpec arma `slabs` (una cáscara
            ShellMITC4 por paño de la grilla, reusando los 4 nudos de esquina, sin mallar) +
            `slab_section` {E, ν=0.2, h=espesor equiv. del tipo de losa, ρ=0}. El motor
            (opensees_engine.py) define ops.section('ElasticMembranePlateSection', …) + un
            ops.element('ShellMITC4', …) por paño y expone datos.n_losas/losa_membrana. ρ=0 a
            propósito: la masa sigue concentrada por piso (fuente de masa, sin doble conteo) y el
            plano lo gobierna el DIAFRAGMA RIGIDO (igual que ETABS con losa membrana + diafragma);
            la losa queda explícita en el conteo y el camino a shell-thin (ρ/placa) listo. El
            conteo "Losas" de OpenSees deja de ser "—". Solo motor + frontend (el motor corre como
            subproceso → servidor SIGUE en v1.27.0, NO reiniciar).
  - v3.26.0 EXTRAER MODELO DE ETABS para comparar + espectro de OpenSees = El Espectro de
            Diseño + LOSAS con shell (pedido del usuario: "el espectro en opensees debe ser
            el mismo de la pestaña ESPECTRO DE DISEÑO (X e Y distintos); el resumen del modelo,
            secciones y masas deben extraerse de ETABS para comparar; que aparezcan las losas y
            con qué tipo de elemento -membrana o shell-thin-"). (1) buildOpenSeesSpec ahora toma
            el espectro DIRECTO de calcEspectroDiseno(disenoEspectro): SaX (R=Rx) y SaY (R=Ry),
            espectros distintos por dirección (ya no vía espectroParams). (2) Servidor v1.27.0:
            nuevo GET /etabs/extraer-modelo lee del modelo real: conteo de elementos (columnas/
            vigas/losas/muros por orientación), secciones de columna/viga con A/E/Iy/Iz calculados
            (de b×h + f'c del inventario), LOSAS con su TIPO DE SHELL (membrana/shell-thin, de
            PropArea.GetSlab 2do entero -> SHELL map) y masas por piso (tabla "Centers Of Mass And
            Rigidity" en kN-m -> tonne, helper leer_masas_por_piso). extraer_inventario gana el
            campo shell en las losas. (3) Frontend: botón "📡 Extraer de ETABS" en la pestaña
            OpenSees + tarjeta que compara conteos/secciones/masas ETABS vs OpenSees y lista las
            losas con su shell (membrana en ámbar). SUBE EXPECTED_SERVER_VERSION a 1.27.0 ->
            REINICIAR EL SERVIDOR. App v3.26.0.
  - v3.25.1 VINCULO AUTOMÁTICO espectro/deriva ← El Espectro de Diseño (pedido del usuario:
            "el factor de deriva debe calcularse automáticamente con la info del espectro;
            la pestaña de espectro de respuesta debe vincularse al espectro de diseño; puedo
            tener diferentes espectros para X e Y"). Nuevo useEffect sobre disenoEspectro:
            sincroniza espectroParams (z,u,s,tp,tl, r=Rx, sfX=1, sfY=Rx/Ry) y comboParams
            (factorDerivaX=(0.85/0.75)·Rx, factorDerivaY=·Ry). Así el paso "Espectro" (función
            de ETABS) y el FACTOR DE DERIVA se calculan SOLOS desde la pestaña El Espectro de
            Diseño (única fuente de verdad), con R = R0·Ia·Ip por dirección. ESPECTROS DISTINTOS
            X/Y: el espectro Y sale del X con SF = Rx/Ry (Sa_Y = Sa_X·Rx/Ry); buildSpectrumBody
            y buildOpenSeesSpec ya aplican sfY, así que la demanda Y queda con Ry. UI: en el paso
            Espectro, Z/U/S/TP/TL/R/SF son de SOLO LECTURA con aviso de vínculo; en Combinaciones,
            Factor deriva X/Y de solo lectura + nota "automático". Solo frontend. App v3.25.1.
  - v3.25.0 R DE DERIVA = R0·Ia·Ip POR DIRECCIÓN + elementos dibujados + peso volumétrico
            (pedido del usuario, mostrando R-X=4 / R-Y=3 en el Resumen del cálculo: "el
            valor de R para la deriva es R=R0*Ia*Ip; dame la cantidad de elementos dibujados
            y el peso volumétrico de los materiales"). (1) El factor de deriva ahora usa
            R = R0·Ia·Ip de CADA dirección (dEsp.Rx, dEsp.Ry del Espectro de Diseño), NO
            espectroParams.r: factorX = (0.85 si irregular / 0.75 regular)·Rx, factorY =
            ·Ry. comboParams pasó de factorDeriva (único) a factorDerivaX / factorDerivaY;
            buildLoadCombosBody usa FACTOR_DERIVA_X en DERVX y FACTOR_DERIVA_Y en DERVY. El
            paso Combinaciones tiene 2 inputs (X/Y) + recomendación por dirección con botón
            "Usar". La comparación OpenSees amplifica con ampX/ampY y el banner verifica
            ambos (esperado vs ETABS, por dirección). (2) La pestaña 🔧 OpenSees muestra el
            PESO VOLUMÉTRICO (γ concreto de matParams.peso, Fy del acero) y la CANTIDAD DE
            ELEMENTOS DIBUJADOS del Modelador (columnas/vigas/losas/muros), en la línea de
            datos y en el Resumen del modelo. Solo frontend. App v3.25.0.
  - v3.24.5 FACTOR DE DERIVA 0.75R / 0.85R según regularidad (pedido del usuario: "para
            la combinación de deriva debe multiplicarse la fuerza sísmica por 0.75R si la
            estructura es regular, 0.85R si es irregular; verifica eso para etabs y
            opensees"). Antes la amplificación de deriva estaba FIJA en 0.75R. Ahora: la
            REGULARIDAD se determina por las irregularidades del espectro (disenoEspectro:
            si Iax/Iay/Ipx/Ipy < 1 → IRREGULAR); el factor teórico = (irregular?0.85:0.75)·R
            con R = espectroParams.r. La comparación OpenSees usa el MISMO factor que ETABS
            (comboParams.factorDeriva = SF del combo DERVX/Y) para que sea igual, y un BANNER
            verifica que ese factor coincida con el teórico (✓/⚠ con el valor a corregir). El
            paso Combinaciones muestra la recomendación (estructura regular/irregular · R →
            factor) con botón "Usar X" que ajusta comboParams.factorDeriva. Las 3 amplifica-
            ciones de deriva del frontend (comparación OpenSees, parciales, card de Resultados)
            pasaron a usar el factor correcto. Solo frontend. App v3.24.5.
  - v3.24.4 FIX: OpenSees usa el MISMO espectro que ETABS (pedido del usuario: "la
            diferencia esta en la carga sismica... el espectro de respuesta en opensees
            se debe definir de la misma manera que se hizo en etabs"). El cortante basal
            salia 3-4x alto y asimetrico porque buildOpenSeesSpec armaba el espectro con
            disenoEspectro (pestaña "El Espectro de Diseño", con otro R por direccion/mas
            demanda). AHORA el espectro se toma del paso "Espectro" (espectroParams) que es
            el que genera la funcion en ETABS: Sa = Z·U·C·S/R·g (cFactorE030, g=9.80665, los
            MISMOS Z/U/S/TP/TL/R) y se aplican los MISMOS factores de escala del caso
            sfX/sfY → SaX = Sa·sfX, SaY = Sa·sfY. _meta.Rx pasa a ser espectroParams.r (la
            amplificacion de deriva 0.75R queda coherente). La pestaña muestra "Espectro
            (= el de ETABS): nombre · Z..R · SF X/Y" para verificar. Solo frontend (CM/CV/
            masa ya coincidian). App v3.24.4.
  - v3.24.3 CARGAS/MASA/PESO TOTALES en la comparación (pedido: "que se vea el total de
            las cargas, CM, CV, CSX, CSY etc, la masa total, peso total, para comparar
            ETABS y OpenSees"). buildOpenSeesSpec ahora acumula y expone en _meta el peso
            muerto (ΣWcm), vivo (ΣWcv), sísmico (=masaTot) en tonf. En la card de
            comparación, nueva tabla "Cargas, masa y peso totales (tonf·ton)": una fila por
            cada caso de resData.cortante_basal (CM/CV/CE → FZ = peso; CSX/CSY → FX/FY =
            cortante; kgf→tonf por la reacción dominante) mapeada a su equivalente OpenSees
            (CM→peso muerto, CV→peso vivo, CSX/CSY→cortante espectral) + filas Peso sísmico
            (masaCM·CM+masaCV·CV) y Masa sísmica (ton), todo ETABS|OpenSees|Δ%. El cortante
            basal se quitó de "Globales" (ahora "Respuesta dinámica": T1, masa partic., der.
            máx) para no duplicar. El Resumen del modelo (siempre visible) muestra peso
            muerto/vivo/sísmico de OpenSees. Solo frontend. App v3.24.3.
  - v3.24.2 COMPARACION DATO A DATO ETABS vs OpenSees (pedido: "ahora dame datos
            comparando todos los datos, dato a dato contra lo obtenido en etabs"). En la
            pestaña 🔧 OpenSees, card "⚖️ Comparación dato a dato" (si hay osData + resData;
            si falta ETABS, botón "Leer resultados de ETABS"): (1) GLOBALES T1/masa X-Y/
            cortante X-Y/deriva máx X-Y con ETABS|OpenSees|Δ%; (2) PERIODOS por modo
            (ambos ordenados desc., pareados por índice → robusto ante el orden/dirección
            de modos); (3) POR PISO a ancho completo: Ux/Uy (mm) y Deriva X/Y, ETABS|OS|Δ
            por columna, alineados por elevación tope→base. Mapeo de campos ETABS: modal
            {UX,UY,sumUX,sumUY} (ratios→%), cortante_basal[CSX/CSY].FX/FY (kgf→tonf),
            desplazamientos.por_caso[CSX/CSY] (mm), derivas.perfil[DERVX/DERVY] (inelástica
            ya ×4.335). La deriva de OpenSees se amplifica ×0.75R para el contraste. Solo
            frontend. App v3.24.2.
  - v3.24.1 OpenSees: GLOSARIO + RESULTADOS PARCIALES (pedido del usuario: "explica que
            hace cada comando de opensees y que significa cada argumento, dame resultados
            parciales tambien para comparar con etabs"). En la pestana 🔧 OpenSees: (1)
            "Resultados parciales" — tabla MODAL por modo (T, f=1/T, masa X%, masa Y%, masa
            ACUMULADA X/Y -> chequeo E.030 >=90%) y tabla POR PISO (Ux/Uy en mm, deriva X/Y
            elastica + columna ×0.75R inelastica para comparar con DERVX/Y) + cortante basal
            X/Y en tonf; tope->base como ETABS. (2) Glosario plegable "que hace cada comando
            y que significa cada argumento" con cada funcion ops.* usada (model/node/fix/
            geomTransf/element/mass/rigidDiaphragm/eigen/nodeEigenvector): firma + descripcion
            + cada argumento explicado; se filtra a las funciones realmente presentes en la
            traza. Solo frontend (los datos ya venian del motor: modal.tabla, espectral.perfil).
            Validado: vite build + render en vivo. App v3.24.1.
  - v3.24.0 PESTANA "🔧 OpenSees": ver TODO el flujo ejecutado en OpenSees (pedido del
            usuario: "una nueva pestana para ver todo el flujo... datos colocados, todas
            las funciones utilizadas y sus argumentos"). El motor opensees_engine.py ahora
            ENVUELVE el modulo openseespy con un grabador (_OpsRec) que registra CADA
            llamada ops.* con sus argumentos como una linea de codigo, reenviando la
            llamada real (la traza coincide exactamente con lo ejecutado) + marcadores de
            seccion; devuelve `script` (la traza completa), `datos` (resumen: nudos/cols/
            vigas/apoyos/modos, secciones A/E/Iy/Iz/J colocadas, masas por piso con su
            nudo maestro e inercia Izz, unidades) y `n_comandos`. El servidor NO cambia
            (el motor corre como subproceso, los cambios aplican sin reiniciar). Frontend:
            nueva pestana renderOpenSees con (1) resumen del modelo, (2) tablas de
            secciones y masas por piso colocadas, (3) el FLUJO de comandos OpenSees con
            sus argumentos (headers de seccion resaltados) + Copiar y Descargar .py
            (traza runnable: import + modelo + analisis). Solo frontend + motor. Validado:
            vite build + selftest del motor (292 comandos, ops.node/element/mass/eigen con
            valores reales) + render en vivo.
  - v3.23.1 OpenSees usa AHORA LOS MISMOS DATOS que van a ETABS (pedido del usuario:
            "en opensees usa otros datos, quiero que use los mismos datos que se usa
            para llevar a etabs"). buildOpenSeesSpec ya NO usa inputs manuales (f'c,
            col/viga b×h, peso/m2); deriva todo del estado real del flujo: f'c y peso
            del concreto de matParams, seccion de columna de colParams, de viga de
            vigaParams, y la MASA SISMICA por piso de TUS cargas reales: W_CM = peso
            propio (vigas + columnas tributarias + losa segun su tipo/dimensiones) +
            CM superpuesta (slabLoadParams.cargaCM*area + beamLoadParams.cargaCM*Lvigas);
            W_CV = slabCV*area + beamCV*Lvigas; masa = (masaCM*W_CM + masaCV*W_CV)/1000
            (masaCM/masaCV de espectroParams, la misma fuente de masa de ETABS). La UI
            quita los inputs manuales y muestra un panel "Datos usados (de tu flujo)" con
            f'c, secciones, losa+peso propio, cargas y masa/piso; solo queda editable el
            #modos. Solo frontend (servidor sin cambios). Validado: vite build + numerico.
  - v3.23.0 VERIFICACION CRUZADA con OpenSeesPy (complemento OPCIONAL a ETABS,
            pedido del usuario). OpenSees corre en un VENV PYTHON 3.12 dedicado
            (osenv312) porque su binario de Windows es para 3.12; el servidor (3.13
            + ETABS/comtypes) lo invoca por SUBPROCESO con JSON in/out. Nuevo motor
            opensees_engine.py: reconstruye un modelo elastico 3D equivalente
            (columnas en cada interseccion de la grilla + vigas por linea de eje,
            DIAFRAGMA RIGIDO por piso, masas por peso/m2) y corre MODAL (T, masa
            participativa por participacion manual robusta) + ESPECTRAL E.030 (cortante
            basal por SRSS de masas efectivas, derivas por SRSS de desplazamientos
            modales). Servidor v1.26.0: POST /opensees/verificar (corre el motor en el
            venv) + GET /opensees/estado. Frontend: en la pestana Resultados, tarjeta
            "Verificar con OpenSees" con secciones representativas (f'c, col/viga b×h,
            peso/m2, #modos); buildOpenSeesSpec arma el modelo de forma DETERMINISTA
            desde la grilla (ordsPreview) + pisos (nivelesPreview) + el espectro
            (calcEspectroDiseno) y muestra una tabla ETABS vs OpenSees (T1, masa,
            cortante, deriva con Δ%; la deriva elastica se amplifica ×0.75R para
            comparar con la inelastica DERVX/Y de ETABS). Validado: openseespy
            importa+corre en el venv 3.12 (el de 3.13 fallaba por python312.dll);
            motor en edificio canonico 4 pisos (T1=0.576s, masa->100%, V y derivas
            coherentes); puente servidor (py_compile + subproceso con spec en archivo).
            SUBE EXPECTED_SERVER_VERSION a 1.26.0 -> REINICIAR EL SERVIDOR.
  - v3.22.1 MEMORIA del ESPECTRO DE RESPUESTA: la pestana "Memoria" gana un SELECTOR
            de documento (Materiales | Espectro de respuesta). El nuevo documento es
            una hoja A4 estilo ANEXO 2 de la hoja del usuario: 1) tablas de factores
            (Zona/Suelo/Uso/Sistema X-Y), 2) irregularidades en altura (Ia) y planta
            (Ip) con marcas por direccion y "se toma el valor mas critico", 3) resumen
            (Z,U,S,TP,TL | Ro,Ia,Ip,R,g) + formulas KaTeX (Sa=ZUCS/R*g, R=Ro*Ia*Ip) +
            DOS graficos blancos SvgEspectroDoc (X-X azul, Y-Y rojo, marcadores TP/TL),
            4) tabla T-Sa de 48 puntos (2 columnas). Lee disenoEspectro (misma fuente
            del paso Espectro). Exporta a PDF (mismo #memoria-hoja + @media print) y a
            LaTeX/.tex (buildMemoriaEspectro: tabular + align + pgfplots + longtable).
            Los handlers de export usan el documento activo (memoDoc). Solo frontend.
            Validado: vite build + render en vivo (8 tablas, 2 graficos, 48 filas, 2
            formulas KaTeX, sin id duplicado) + sin regresion en Materiales.
  - v3.22.0 EL ESPECTRO DE DISENO (E.030-2026): la pestana "Vista previa" se
            REEMPLAZA por una pestana dedicada al espectro de diseno, fiel a la
            hoja del usuario "ESPECTRO DE RESPUESTA SISMICA - 2026.xlsx" (pedido:
            "la pestana de VISTA PREVIA cambiala por EL ESPECTRO DE DISENO").
            Selectores Zona (Z) / Suelo (S,TP,TL) / Uso (U) / Sistema X-Y (R0) +
            irregularidades en ALTURA (Ia) y PLANTA (Ip) con checkbox por
            direccion -> Ia/Ip = MIN de las marcadas; R = R0*Ia*Ip por direccion.
            C con la rama corta 1+7.5*T/Tp; Sa = Z*U*C*S*g/R (g=9.81 de la hoja).
            Grafico Sa-T (X azul / Y rojo punteado, plataformas TP/TL) +
            resumen + tabla T-Sa (48 ptos de la norma) con Copiar / TXT X / TXT Y
            para "From File" en ETABS. Boton "Aplicar al paso Espectro" rellena
            espectroParams (Z,U,S,TP,TL,R=Rx, SF Y=Rx/Ry) -> la funcion de usuario
            en ETABS sale de aqui (un solo origen). Datos/calculo deterministas:
            ZONAS/SUELOS/USOS/SISTEMAS/IRREG_ALTURA/IRREG_PLANTA + calcEspectroDiseno
            + SvgEspectroDiseno. Estado disenoEspectro persistido en localStorage.
            Las vistas planta/elevacion/3D/seccion se quitaron de esta pestana
            (decision del usuario: reemplazo total); el selector de fuente de
            grilla se movio al Modelador. Solo frontend (servidor sin cambios).
  - v1.0.0  Puente React-Python, modos de sesion, test de modelos IA.
  - v1.1.0  Scripts completos autonomos (corren igual en cmd). Modo raw_script.
            Boton "Guardar .py". InitializeNewModel antes de tocar SapModel.
  - v1.2.0  Panel "Herramientas" con flujos validados (golden patterns).
            Biblioteca de flujos persistida en disco (flujos_validados.json).
            Boton "Guardar como flujo" para codigo que ya funciono.
            Reglas de grilla: NewGridOnly = uniforme; SetGridLine NO existe;
            grilla no uniforme via Database Tables.
  - v1.3.0  DOCUMENTACION OFICIAL INTEGRADA: base de datos con 1529 entradas
            de la API (firmas exactas, notas y ejemplos) extraida del CHM de
            ETABS 22 instalado. El servidor la expone en /api-docs/search y
            cada instruccion a la IA inyecta automaticamente los metodos
            relevantes. Buscador manual en el panel API Docs.
  - v1.3.1  ANTI PROCESOS COLGADOS: patron conectar_y_preparar_modelo que
            valida el attach con una llamada real y abre instancia nueva si
            falla (ETABS zombie acepta attach pero da 'Puntero no valido').
            Ruta del exe fijada a ETABS 22 (hay varias versiones instaladas).
            Mantenimiento en Herramientas: ver/cerrar procesos ETABS.
            Regla 13: prohibido try/except global que oculte errores.
  - v1.3.2  GetObject/CreateObject pueden devolver None SIN excepcion:
            plantilla de conexion con chequeos de None obligatorios.
            Regla 14: la IA debe copiar la plantilla LITERALMENTE.
            Regla 15: validar None y prohibido except-pass silencioso.
  - v1.4.0  EXPLORADOR VISUAL DE LA API: API_ETABS_Explorer.html (autonomo,
            doble clic) con las 1529 entradas navegables: buscador en espanol,
            categorias, firmas, parametros ByRef, plantillas Python, notas y
            693 ejemplos oficiales. Servido tambien en /explorer y enlazado
            desde el panel API Docs.
  - v1.5.0  VALIDACION ANTI-ALUCINACION: el servidor revisa cada metodo
            PascalCase del codigo contra los 1529 reales de la API y BLOQUEA
            los inventados (SetGridLine) ANTES de abrir ETABS, con sugerencias
            de metodos parecidos. En /execute-etabs, /preflight y el boton
            Preflight (que ahora combina validacion local + servidor).
  - v1.5.1  HALLAZGOS EMPIRICOS (diagnostico directo sobre ETABS 22):
            NewGridOnly con modelo ya creado CRASHEA el proceso (RPC muerto)
            -> bloqueado server-side si NewBlank+NewGridOnly coexisten.
            'Object reference not set' al reutilizar instancia es TRANSITORIO
            -> helper reintentar() en la plantilla + sleep tras Initialize.
            Reglas DatabaseTables: TableData lista PLANA, sin GroupName,
            flujo obligatorio Get -> modificar -> Set -> Apply.
  - v1.6.0  COMPOSICION DE BLOQUES (la IA ya no escribe la conexion):
            la app ensambla bloque base validado (segun modo) + funcion
            construir_modelo(sap_model) generada por la IA. Regla 12:
            prohibido rendirse (script que solo imprime advertencias).
            AUTO-REPARACION: al fallar, un reintento automatico con el error
            (checkbox en la barra). Herramienta GRILLA NO UNIFORME en el
            panel (Database Tables autodescubridora, sin IA).
  - v1.6.1  GRILLA NO UNIFORME VALIDADA EN ETABS 22 (diagnostico en vivo).
            CAUSA RAIZ de los "ret=-1" en tablas: comtypes ENVUELVE los
            parametros de salida en una lista anidada -> patron desanidar().
            Campos reales de "Grid Definitions - Grid Lines" en ETABS 22:
            Name, LineType, ID, Ordinate, Angle, X1, Y1, X2, Y2, BubbleLoc,
            Visible. Flujo registrado en flujos_validados.json. Regla 9
            actualizada con el patron desanidar.
  - v1.7.0  LECCIONES APRENDIDAS: cuando una reparacion (manual o auto)
            arregla un error y el codigo corre bien, el par error->solucion
            se guarda automaticamente (lecciones_aprendidas.json, endpoints
            /lecciones) y se inyecta a la IA para no repetirlo. Lista con
            borrado en Herramientas. REDISENO VISUAL: header con gradiente,
            terminal estilo macOS con badge de exito, burbujas de chat,
            paneles con blur y animaciones, toast e indicador de carga nuevos.
  - v1.8.0  APRENDIZAJE SIN IA: (1) los flujos validados se EJECUTAN con un
            clic desde Herramientas (botones Ejecutar/Insertar); (2) cualquier
            metodo de la doc oficial se convierte en script ejecutable con
            "Insertar plantilla" (busqueda API Docs con tarjetas, firma,
            notas, ejemplo y parametros reales con placeholders).
  - v1.8.1  Boton "Copiar informe" (error + codigo + contexto al portapapeles
            con un clic). FIX ByRef: en este entorno comtypes EXIGE pasar los
            parametros ByRef como relleno del tipo correcto (omitirlos da
            "required argument missing"); corregido en plantillas de la app,
            del Explorador, regla 9 y todos los textos del contexto.
  - v1.8.2  ANTI SERVIDOR DESACTUALIZADO: el servidor reporta server_version
            en /status y la app muestra banner rojo si no coincide con
            EXPECTED_SERVER_VERSION (frontend nuevo + proceso viejo causaba
            errores confusos). Plan B en plantillas: si el servidor no envia
            params, se extraen de la firma C# (parseParamsFromSignature).
  - v1.8.3  UX DE APRENDIZAJE: preflight bloquea plantillas sin rellenar
            (placeholder "VALOR"); verificar_retorno explica que ret!=0 es
            rechazo de ETABS (no crash); las plantillas Get* avisan que
            consultan objetos que ya deben existir.
  - v1.9.0  HERRAMIENTAS COMO PROTAGONISTA: el lateral ahora tiene pestanas
            (Herramientas por defecto | Asistente IA). Secciones organizadas
            en acordeones numerados segun el flujo de trabajo: 1 grilla,
            2 material de concreto (NUEVO: SetMaterial + SetMPIsotropic +
            SetWeightAndMass + SetOConcrete_1, E por ACI 318), 3 seccion
            rectangular (NUEVO: SetRectangle, T3=peralte/T2=base), flujos,
            lecciones y mantenimiento. Materiales/secciones trabajan sobre
            el modelo ACTUAL (feed_current_model, no reinicializan).
  - v1.9.1  MATERIAL Y SECCION VALIDADOS EN ETABS 22 (en vivo): los 4 pasos
            del material y SetRectangle con ret=0 y relectura confirmada.
            ANTI-FANTASMA en modos "modelo actual" y "abrir .EDB": en una
            instancia viva GetModelFilename NUNCA devuelve None; si es None,
            el proceso esta colgado -> mensaje claro con la solucion
            (Mantenimiento > Cerrar procesos). Flujos material y seccion
            guardados en la biblioteca.
  - v1.10.0 VIGA Y COLUMNA SEPARADAS (validadas en vivo): una seccion
            rectangular queda como COLUMNA por defecto en ETABS; la
            herramienta de VIGA usa SetRectangle + SetRebarBeam (M3 Design
            Only) y la de COLUMNA SetRectangle + SetRebarColumn (P-M2-M3
            con armado: barras por cara, diametros, estribos). Ambas con
            verificacion post-ejecucion (releen el refuerzo y validan).
            Flujos guardados (7 en biblioteca).
  - v1.11.0 DIBUJAR PORTICOS (validado en vivo: 204/204 elementos): lee la
            grilla (Database Tables) y los pisos (GetStories_2) del modelo
            abierto y dibuja columnas en cada interseccion + vigas en cada
            nivel con FrameObj.AddByCoord asignando seccion al crear.
            Pre-chequeo de secciones existentes y verificacion de conteo
            al final. 8 flujos en biblioteca.
  - v1.12.0 OJOS PARA LA IA (idea adoptada de FEA-MCP): endpoint
            /etabs/model-summary lee el modelo abierto (unidades, pisos,
            grilla, materiales, secciones, conteos) y se inyecta en CADA
            prompt como "ESTADO ACTUAL DEL MODELO" -> Gemini usa nombres
            reales en vez de adivinar. Boton "Leer modelo abierto" en
            Herramientas. APOYOS EN LA BASE (validado 20/20): detecta
            puntos en z=base y aplica SetRestraint (empotrado/articulado)
            con verificacion por relectura. 9 flujos en biblioteca.
  - v1.13.0 AUDITOR DE MODELOS EDB: el resumen del modelo ahora incluye
            patrones de carga (con tipo), casos de carga y COMBINACIONES
            con sus formulas y factores (RespCombo.GetCaseList). Sirve para
            auditar cualquier .EDB existente: abrirlo (modo Abrir .EDB o
            manualmente) y pulsar "Leer modelo abierto". La IA recibe todo.
  - v1.14.0 FLUJO DE CARGAS PERUANO (validado, del .e2k del usuario):
            herramienta 7 Patrones de carga (CM/CV/CE, idempotente) y 8
            Combinaciones E.060 (las 11 del flujo: 1.4CM+1.7CV, 1.25(CM+CV)
            +-CSX/Y, 0.9CM+-CSX/Y, EMVOL envolvente, DERVX/Y). RespCombo.Add
            + SetCaseList (devuelve tupla [enum,ret]); idempotentes (borran
            y recrean). Validadas en vivo 2x. 11 flujos en biblioteca.
  - v2.0.0  FLUJO DE TRABAJO PROTAGONISTA (rediseno mayor segun esquema del
            usuario): area principal con pestanas "Flujo de trabajo" |
            "Codigo + Terminal". El flujo es una serie de PASOS guiados con
            DEPENDENCIAS (un paso se desbloquea al completar el previo) y
            COLORES: verde=hecho, cian=disponible, gris=bloqueado, con barra
            de progreso. Estado en localStorage, se marca al ejecutar cada
            herramienta con exito. 13 pasos en 4 fases; losas y asignar
            cargas "proximamente". Aside = Biblioteca + Asistente IA.
  - v2.1.0  ESQUEMA VISUAL (identico al dibujo del usuario): el flujo ahora
            es un DIAGRAMA con cajas posicionadas y FLECHAS SVG que siguen
            las dependencias. Clic en una caja disponible abre su herramienta
            en una ventana modal; cajas bloqueadas avisan que falta; las
            flechas hacia "Asignar cargas" van en rojo (como el esquema).
            Colores: verde=hecho, cian=disponible, gris=bloqueado,
            punteado=proximamente. 14 nodos incluyendo losas futuras.
  - v2.2.0  ROADMAP DE CARGAS Y SISMO COMPLETO (validado en vivo 2x, sandbox
            10/10 OK): (1) DEFINIR LOSAS maciza (SetSlab), aligerada 1D
            (SetSlabRibbed) y 2D/waffle (SetSlabWaffle) con relectura;
            (2) DIBUJAR LOSA en cada pano de la grilla (AreaObj.AddByCoord)
            con verificacion por conteo; (3) CARGAS EN VIGAS
            (SetLoadDistributed, Dir=10 gravedad, kgf/m via
            SetPresentUnits(8), detecta vigas por Z de extremos, filtro por
            seccion); (4) CARGAS EN LOSA (SetLoadUniform kgf/m2, filtro por
            propiedad); (5) ESPECTRO E.030 PARAMETRICO (Z,U,S,TP,TL,R con
            rama C=1+7.5T/TP) creado via Database Tables "Functions -
            Response Spectrum - User Defined" (la API 22 NO tiene
            FuncRS.SetUser ni SetDampConstant; amortiguamiento default 0.05)
            + Modal Ritz (SetCase/SetNumberModes/SetLoads Accel UX-UY) +
            masa sismica CM+%CV (SetMassSource_1) + casos CSX/CSY
            (ResponseSpectrum.SetLoads U1/U2 con 30% ortogonal opcional).
            16 nodos: todos los pasos del esquema implementados.
  - v2.3.0  VISTA PREVIA DEL MODELO (pedido del usuario: "ver lo que estamos
            creando antes de mandarlo a ETABS"). (1) Pestana nueva "Vista
            previa": PLANTA (ejes con burbujas 1,2,3/A,B,C, dimensiones,
            panos de losa, porticos y cargas de losa) + ELEVACION (pisos con
            cotas, columnas, vigas, apoyos y flechas de carga) + SECCION DE
            LOSA (maciza/nervada/waffle con medidas) + CURVA DEL ESPECTRO
            E.030 (meseta, TP, TL) + REGISTRO de que crea cada paso con los
            valores actuales (✓ verde = ya ejecutado) + boton para contrastar
            con el modelo REAL (model-summary). Los overlays de planta y
            elevacion siguen los pasos completados. (2) Mini-preview EN VIVO
            dentro del modal de cada herramienta (grilla, porticos, losas,
            dibujar losa, apoyos, cargas en vigas/losa, espectro): el dibujo
            se actualiza al escribir. Todo determinista (SVG calculado de los
            formularios, sin IA y sin tocar ETABS). Selector de fuente de
            grilla (uniforme / ordenadas no uniformes).
  - v3.0.0  DEL MODELADO A LA VERIFICACION (validado en sandbox 4/4: analisis
            real de 15 s + lectura de resultados). (1) Paso 17 "ANALIZAR":
            File.Save + RunAnalysis + estado de casos (GetCaseStatus, 4 =
            terminado); requiere apoyos y combos. La IA sigue sin poder
            lanzar analisis (regla 10): el boton es el pedido explicito.
            (2) Pestana "RESULTADOS" con chequeos E.030 tipo semaforo:
            masa participativa >= 90% (ModalParticipatingMassRatios) y
            derivas de entrepiso <= limite (StoryDrifts de DERVX/DERVY,
            deduplicando Max/Min del espectro), grafico SVG de derivas por
            piso con linea de limite, tabla modal (T, UX, UY, acumulados),
            cortante basal por caso (BaseReact) y estado de casos. Servidor
            v1.14.0: GET /etabs/resultados?derivas=&limite=&cortantes=&modal=
            (unidades de salida kgf-m). REINICIAR EL SERVIDOR al actualizar.
  - v3.1.0  CHAT AGENTICO CON HERRAMIENTAS (pedido del usuario: conectar las
            tools del MCP al chat). Puente provider-agnostico: el servidor
            expone el catalogo (GET /ai/tools) y un despachador unico
            (POST /ai/tools/run) con las validaciones; el navegador adapta el
            catalogo a function-calling de Gemini, OpenAI y Claude. Toggle
            "Modo agente" en el Asistente: el modelo se informa solo (buscar
            API, leer modelo/flujos/lecciones/resultados) y, con CONFIRMACION
            del usuario (tarjeta con el script a la vista), ejecuta flujos o
            scripts (mismas validaciones anti-alucinacion/anti-crash). Bucle
            de hasta 10 pasos con historia normalizada serializada por
            proveedor. NUEVO proveedor Claude (Anthropic) via proxy del
            servidor (POST /ai/anthropic, evita CORS; la key queda local).
            Servidor v1.15.0. REINICIAR EL SERVIDOR al actualizar.
  - v3.2.0  ESQUEMA EN MATRIZ + MUROS + ACERO (esquema refinado del usuario,
            validado en vivo: sandbox v4 + 4 scripts de produccion ejecutados
            en ETABS real). El flujo se reorganizo a la MATRIZ del usuario:
            por cada elemento las 3 etapas DEFINIR -> DIBUJAR -> CARGAR en
            columnas, y todo desemboca en CORRER ANALISIS (26 nodos). NUEVO:
            (1) DEFINIR ACERO (PropMaterial Rebar + SetORebar_1, Fy/Fu);
            (2) MUROS: definir (PropArea.SetWall, eWallPropType.Specified=1),
            dibujar (paneles verticales sobre ejes de grilla, opcion solo
            perimetro / solo 1er nivel = sotano), cargar con EMPUJE DE TIERRA
            CE (presion uniforme equivalente Ka·γ·H/2, dir local 3; el
            triangular via tablas no es fiable porque el campo Dir rechaza el
            string). Dibujar viga y columna ahora SEPARADOS (buildDrawFramesBody
            con flags dibujarColumnas/dibujarVigas); losas dibujar/cargar por
            tipo. Sin cambios de servidor (sigue v1.15.0).
  - v3.2.1  UNIDADES CORRECTAS (pedido del usuario, validado en vivo): los
            MATERIALES y SECCIONES se definen en kgf-cm (unidad 14) -> f'c=280,
            Fy=4200, E=15000√f'c, dimensiones en cm DIRECTAS (sin convertir a
            kN/m). Las CARGAS y la GEOMETRIA en kgf-m (unidad 8). Cada builder
            fija SetPresentUnits(14 o 8) segun corresponda y restaura 8 al
            final; los de dibujo fijan 8 antes de leer la grilla (las ordenadas
            salen en unidades presentes). Unidad base del modelo = 8 (kgf-m).
            Material: peso ahora en kgf/m3 (2400). Verificado releyendo en vivo:
            f'c=210 -> 210, viga 30x60 cm, etc. Sin cambios de servidor.
  - v3.3.0  MEMORIA DE CALCULO de materiales (pedido del usuario, con sus
            imagenes de referencia ANEXO 1 ACI / ANEXO 2 E.060). Pestana
            "Memoria": generador DETERMINISTA (sin IA) que calcula Ec, Gc, nu,
            fu, fye, fyte segun la norma elegida (E.060: Ec=15000√f'c, Gc=Ec/2.3,
            nu=Ec/2Gc-1 ; ACI 318-19: Ec=15100√f'c, Gc=Ec/(2(nu+1)), nu dato)
            y lo muestra como DOCUMENTO renderizado con KaTeX (cajas azules para
            datos, formulas con resultado, estilo hoja blanca como las imagenes)
            + exporta el CODIGO LATEX (boton Copiar / Descargar .tex, compila en
            Overleaf/pdflatex). Una sola fuente: el mismo LaTeX se renderiza y se
            descarga. Dependencia nueva: katex. Sin cambios de servidor.
  - v3.3.1  HOJA A4 + EXPORTAR A PDF (pedido del usuario): la memoria se muestra
            como una hoja A4 real (210x297mm, margenes, sombra de papel sobre
            fondo gris). Boton "Exportar a PDF" usa window.print() con CSS
            @media print que AISLA la hoja (oculta app/aside/controles via
            .no-print + visibility) y fija @page A4; el usuario elige "Guardar
            como PDF" -> PDF VECTORIAL con las formulas KaTeX nitidas. Colores
            de las cajas con print-color-adjust:exact. Sin dependencias nuevas.
  - v3.3.2  MEMORIA TIPOGRAFIA PROFESIONAL (pedido del usuario): estilo paper
            LaTeX. (1) Fuente Computer Modern reusada de KaTeX (KaTeX_Main) para
            que TEXTO y FORMULAS sean la misma familia; cuerpo 9 pt, margenes
            25 mm, interlineado 1.55. (2) Formulas a la MISMA altura que el texto
            (.katex font-size 1em; antes 1.21em) y unidades compactas con
            \\tfrac. (3) UNIDADES EN REDONDA (\\mathrm) — convencion cientifica:
            las unidades nunca en cursiva, las variables si. (4) Se quito el
            sombreado celeste; filas uniformes; encabezados en negrita y
            referencias de norma en italica gris a la derecha. .tex con lmodern
            + babel spanish. Sin cambios de servidor.
  - v3.3.3  MEMORIA: ajustes pedidos (ref. Mathcad). Fuente y formulas a 10 pt.
            UNIDADES mas grandes (\\dfrac), en AZUL (#1d4ed8) y NEGRITA
            (\\textcolor + \\mathbf), como Mathcad. ENCABEZADO EDITABLE
            (izquierda=proyecto, derecha=web/autor) en la hoja y en el .tex
            (fancyhdr). PIE con numero de pagina: en el .tex via fancyhdr +
            lastpage (Pagina X de Y); en el PDF del navegador via @page
            @bottom-center counter (Firefox) o el toggle de encabezados/pies
            del dialogo (Chrome). KaTeX usa Computer Modern (no se puede cambiar
            a fuente tipo Mathcad sin cambiar de motor). Sin cambios de servidor.
  - v3.3.4  MEMORIA: pie de pagina al FONDO de la hoja (hoja-a4 como flex column
            + mem-pie margin-top:auto; en print min-height 269mm para fijar el
            area imprimible) y el pie ahora muestra SOLO el numero de pagina
            ("Pagina X de Y"), sin proyecto ni fecha. Sin cambios de servidor.
  - v3.4.0  MULTI-INSTANCIA + MULTI-PROYECTO + DIAGNOSTICO (pedido del usuario,
            validado: GetObjectProcess distingue instancias por PID).
            (1) SELECTOR DE INSTANCIA ETABS en la barra: lista los ETABS abiertos
            (PID + modelo, de /etabs/processes); el PID elegido se usa en TODAS
            las lecturas (?pid=) y se INYECTA en la conexion de los scripts
            generados (PID_OBJETIVO + attach_etabs con GetObjectProcess). "Auto"
            = la instancia registrada. (2) NOMBRE DE PROYECTO editable: el
            progreso de pasos se guarda POR proyecto (localStorage
            etabs_steps_done__<proyecto>); cambiar el nombre carga su progreso.
            (3) DIAGNOSTICAR MODELO: GET /etabs/diagnostico lee que esta definido
            en el modelo real (concretos, aceros, secciones viga/columna, losas
            1D/2D/maciza, muros, frames, areas, apoyos, patrones, casos, combos,
            analisis) y AUTO-MARCA los pasos del flujo. Servidor v1.16.0
            (GetObjectProcess + /etabs/diagnostico + ?pid= en model-summary/
            resultados). REINICIAR EL SERVIDOR al actualizar.
  - v3.21.11 CORRER ANALISIS: boton "📁 Examinar…" para ELEGIR la ruta .EDB con el
            explorador NATIVO (pedido del usuario). El navegador no puede abrir un
            dialogo del sistema, asi que lo abre el SERVIDOR (local): servidor v1.25.0,
            nuevo GET /etabs/elegir-ruta-edb?nombre= -> lanza un subproceso con tkinter
            filedialog.asksaveasfilename (defaultextension .EDB, initialdir Documentos\\
            ETABS_API_modelos, initialfile <proyecto>) en TU maquina y devuelve la ruta
            (normpath + asegura .EDB; vacio = cancelado). Frontend: handleElegirRutaEdb
            llena analizarParams.rutaGuardado. El dialogo aparece en la maquina del
            servidor (la misma del usuario). Validado: plumbing del subprocess (argv +
            stdout utf-8 + normpath + .EDB) + tkinter importable + py_compile servidor +
            vite build. SUBE EXPECTED_SERVER_VERSION a 1.25.0 -> REINICIAR EL SERVIDOR.
  - v3.21.10 MODELADOR: la GRILLA leida PERSISTE al recargar (pedido del usuario:
            "que se mantenga al recargar"). Solo frontend: `modeloGeo` (grilla + pisos
            + snapshot con nombres) y `fuenteGrilla` ahora se guardan en localStorage
            (etabs_modelo_geo / etabs_fuente_grilla) y se restauran al iniciar, igual
            que el dibujo (etabs_dibujo). Asi, al reabrir el navegador, el Modelador
            sigue mostrando la grilla real, los elementos alineados y el snapshot para
            "Llevar a ETABS" (sin tener que volver a "Leer de ETABS"). vite build OK.
  - v3.21.9 MODELADOR "Llevar a ETABS" EJECUTA DIRECTO + maneja MODELO BLOQUEADO
            (pedido del usuario: "al click debe llevarlo a etabs, no a codigo/terminal;
            si esta bloqueado por el analisis, advertir y poder desbloquear"). (1)
            EJECUCION DIRECTA: llevarAEtabs ahora ejecuta el script de sync con
            executeCode (POST /execute-etabs) en vez de abrir Codigo+Terminal. (2)
            BLOQUEO: servidor v1.24.0 nuevo GET /etabs/estado-modelo?pid= -> {bloqueado:
            GetModelIsLocked()}. Antes de aplicar, llevarAEtabs lo consulta; si el
            modelo esta bloqueado (candado tras correr el analisis) el confirm AVISA que
            se descartaran los resultados, y si aceptas el script DESBLOQUEA
            (SetModelIsLocked(False), via buildDibujoManualBody param `desbloquear`).
            La grilla: "Leer de ETABS" ya fija fuenteGrilla='real' + modeloGeo, asi que
            el Modelador YA reconoce la grilla real (ords + niveles) para mostrar y
            hacer snap. Validado: py_compile servidor + GetModelIsLocked en vivo + vite
            build. SUBE EXPECTED_SERVER_VERSION a 1.24.0 -> REINICIAR EL SERVIDOR.
  - v3.21.8 MODELADOR "LLEVAR A ETABS" — sincroniza el dibujo con el modelo (pedido
            del usuario: "una opcion para llevar a etabs, que los nuevos se dibujen y
            los borrados se borren"). DIFF por GEOMETRIA (helper claveGeo: tipo+nivel+
            coords redondeadas): lo que esta en el dibujo y NO en lo leido (modeloGeo)
            = NUEVO -> se agrega; lo que estaba en ETABS y se quito del dibujo = BORRADO
            -> se borra por su NOMBRE. Servidor v1.23.0: /etabs/modelo-geometria ahora
            incluye `name` (nombre del frame/area) en cada elemento, para poder
            borrarlo. buildDibujoManualBody extendido con `borrar` ([{tipo,name}]) ->
            FrameObj.Delete / AreaObj.Delete antes de los AddByCoord; print de
            "creados/borrados". Boton ámbar "⬆️ Llevar a ETABS" en el panel del
            Modelador (junto a "Leer de ETABS") -> genera el script de sync y lo abre
            en "Codigo + Terminal" para revisar y ejecutar (filosofia de la app).
            Validado: py_compile servidor + vite build + py_compile del script de sync
            (con borrados y agregados). SUBE EXPECTED_SERVER_VERSION a 1.23.0 -> REINICIAR.
  - v3.21.7 MODELADOR lee la GEOMETRIA REAL de ETABS (pedido del usuario: "el
            modelador debe actualizar la informacion de lo que hay en etabs").
            Servidor v1.22.0: nuevo GET /etabs/modelo-geometria?pid= lee los FRAMES
            (clasificados columna=vertical / viga=horizontal) y AREAS (losa=horizontal
            / muro=panel vertical) con sus COORDENADAS en m (FrameObj/AreaObj.GetPoints
            + PointObj.GetCoordCartesian + GetSection/GetProperty), la grilla y los
            pisos (extraer_geometria); cada elemento trae tipo/coords/sec/nivel en el
            MISMO formato del Modelador. Frontend: boton "📥 Leer de ETABS" en el panel
            del Modelador -> fetch, reemplaza el dibujo (confirma si habia algo),
            fija fuenteGrilla='real' y carga la grilla+pisos REALES (gridReal ahora
            prefiere modeloGeo). Validado en vivo contra Proyecto2: 100 columnas + 160
            vigas + 64 losas, por nivel 1-4, grilla 0,5,9,15,20 × 0,5,9,14,22, secciones
            C40X40/V30X60/LA1D_H25 + py_compile + vite build. SUBE
            EXPECTED_SERVER_VERSION a 1.22.0 -> REINICIAR EL SERVIDOR.
  - v3.21.6 DERIVAS estilo "Maximum Story Drifts" (perfil curvo) en Resultados
            (pedido del usuario: "implementa este grafico para ver las derivas").
            Servidor v1.21.0: la seccion derivas de /etabs/resultados ahora trae
            ademas `perfil` (por caso/combo: por piso dx=drift X / dy=drift Y, de
            StoryDrifts; direcciones reales 'X'/'Y') + base_z; las elevaciones se
            calculan UNA vez (compartidas con desplazamientos). Frontend: nuevo
            componente SvgDerivasPerfil (piso en el eje vertical de Base al tope,
            deriva en x10^-3 en el horizontal; drift X azul, drift Y rojo punteado,
            + linea ambar del limite E.030, como ETABS). Reemplaza el grafico de
            BARRAS SvgDerivas (queda sin uso) en la tarjeta de derivas; la tabla se
            mantiene. Validado en vivo contra Proyecto2: DERVX Story1 dx=0.011953
            (= exacto al plot de ETABS "Max 0.011953, Story1") + vite build + render
            en preview (mock). SUBE EXPECTED_SERVER_VERSION a 1.21.0 -> REINICIAR SERVIDOR.
  - v3.21.5 DESPLAZAMIENTOS MAXIMOS POR PISO en la pestaña Resultados (pedido del
            usuario: "extrae y grafica esos resultados [Story Response]"). Servidor
            v1.20.0: GET /etabs/resultados ahora trae `desplazamientos` (param
            `desplaz`, default "CSX,CSY") = max por piso de Results.JointDrifts
            (DisplacementX/Y, convertido de m a mm) + elevaciones de GetStories_2.
            Frontend: nuevo componente SvgDesplazamientos (perfil estilo "Story
            Response": piso en el eje vertical de Base al tope, desplazamiento en mm
            en el horizontal; Ux azul, Uy rojo punteado, como ETABS) + tabla por
            caso, en una tarjeta a todo lo ancho de Resultados. Input "Desplazam. por
            piso (coma)". Validado en vivo contra Proyecto2: CSX Story4 Ux=25.27 mm
            (coincide exacto con el plot de ETABS "Max 25.274083"). SUBE
            EXPECTED_SERVER_VERSION a 1.20.0 -> REINICIAR EL SERVIDOR.
  - v3.21.4 GRILLA no uniforme = API PURA, EN MEMORIA, SIN ARCHIVOS (decisión final
            del usuario: "no quiero exportar/importar e2k, directo de la API"). Tras
            investigar a fondo (búsqueda en las 1529 entradas de la API + pruebas en
            vivo con capturas) se CONFIRMÓ que la API COM de ETABS 22 NO puede dibujar
            las cotas de espaciamiento no uniformes en memoria: no hay
            SetGridSysCartesian (cGridSys solo SetGridSys=origen), la tabla Grid Lines
            solo tiene Ordinate (editar no regenera las cotas, cacheadas en el EDB
            binario), y no hay API de "dimension lines" ni de regenerar. Las cotas
            solo las genera NewGridOnly (uniforme), el GUI "Custom Grid Spacing" o
            cargar un .e2k de texto. El usuario eligió API pura SIN cotas (geometría
            correcta) antes que cualquier round-trip de archivo. buildNonUniformGridBody
            = File.NewBlank() + pisos por API (SetStories_2) + grilla por Database
            Tables (GENERAL antes que GRID LINES) + encuadre con 2 puntos temporales
            (Count->0). Se quitó la vía e2k de v3.21.3. Validado en vivo: ejes A-E/1-4
            no uniformes, plano encuadrado, sin cotas + vite build + py_compile.
            Regla 6 reescrita con la limitación documentada.
  - v3.21.3 COTAS CORRECTAS en la grilla no uniforme via REIMPORT e2k (pedido del
            usuario: tras v3.21.2 el grid salia SIN cotas y el usuario las QUIERE,
            pero con las luces reales; senalo la opcion "Custom Grid Spacing").
            Diagnostico EN VIVO con capturas: NewGridOnly dibuja las cotas pero solo
            uniformes; editar ordenadas mueve los ejes pero las cotas siguen con la
            luz de CREACION porque ETABS guarda un "spacing" cacheado en el EDB
            binario, separado de las coordenadas (no se arregla editando, ni con
            RefreshView, ni guardando/reabriendo el EDB). La API no tiene
            SetGridSysCartesian (cFile solo: NewGridOnly uniforme / NewBlank). HALLAZGO
            CLAVE: el archivo de TEXTO .$et/.e2k guarda la grilla SOLO como coordenadas
            (sin el spacing). Al REIMPORTAR el .e2k, ETABS reconstruye y RECALCULA las
            cotas desde las coordenadas -> muestran las luces reales (5,4,6,5) y de
            paso ENCUADRA el plano. buildNonUniformGridBody ahora: NewGridOnly (pisos
            + grilla, asigna A-E/1-4) -> editar ordenadas -> File.Save (escribe .$et en
            %TEMP%/etabs_grilla) -> copiar .$et a .e2k -> File.OpenFile. Se quitaron el
            truco de SetStories_2/General/puntos de v3.21.2 y la func etiquetaEjeAlfabetica.
            Validado EN VIVO con captura: cotas X 5/4/6/5, Y 5/4/5, plano encuadrado +
            vite build + py_compile + script de produccion standalone. Regla 6 reescrita.
  - v3.21.2 FIX cota fantasma de 1 m — SOLUCION DEFINITIVA SIN NewGridOnly (pedido
            del usuario: "busca otra manera de hacer los ejes sin editarlos").
            v3.21.1 (borrar grilla base + recrear) NO bastaba: la cota de 1 m que
            dibuja NewGridOnly SOBREVIVE incluso al borrar/recrear el sistema de
            grilla. Diagnostico EN VIVO: la cota es un artefacto de dibujo de
            NewGridOnly, independiente del sistema de grilla. Nueva via (validada
            con CAPTURA real de ETABS): NO usar NewGridOnly. buildNonUniformGridBody
            ahora hace File.NewBlank() (modelo vacio, sin cota), crea los PISOS por
            API (Story.SetStories_2: base 0, Story1 abajo, ultimo master, alturas
            [h1, htyp...]) y la GRILLA "nace" no uniforme desde las Database Tables
            (GENERAL primero, luego GRID LINES; X=letras, Y=numeros). Como NewBlank
            no tiene objetos, RefreshView no encuadra -> se crean 2 PUNTOS de esquina
            temporales, se hace zoom y se borran (PointObj.Count -> 0, no afectan
            apoyos/diagnostico). buildCurrentGridScript SIEMPRE usa esta via (se quito
            la ruta hibrida con NewGridOnly; buildGridScript queda sin uso). Validado
            en vivo: ejes A-E/1-4 no uniformes, plano encuadrado, SIN cota; pisos
            Story1..4 elev 3.5/6.5/9.5/12.5; Count=0. Regla 6 de la doc reescrita.
  - v3.21.1 FIX cota fantasma de 1 m en la grilla NO uniforme (pedido del usuario,
            diagnosticado y validado EN VIVO). Sintoma: los ejes quedaban en las
            posiciones correctas (5,4,6,5) pero ETABS mostraba unas acotaciones de
            "1 (m)" cerca del origen que no coincidian con los ejes. Causa raiz
            (diagnostico en vivo via MCP sobre el modelo del usuario): NewGridOnly
            crea la grilla base con espaciamiento 1 m y dibuja una ACOTACION de
            espaciamiento uniforme; al editar SOLO la columna Ordinate de la tabla
            "Grid Definitions - Grid Lines" los ejes se mueven pero esa cota de 1 m
            NO se regenera (ni con RefreshView). La API NO tiene SetGridSysCartesian
            (solo SetGridSys del origen), asi que la tabla es la unica via. Cura:
            buildNonUniformGridBody ahora BORRA la grilla base (GridSys.Delete) y la
            RECREA "nacida" no uniforme via Database Tables — primero la tabla
            GENERAL (define el sistema; si se escriben las lineas sin que el sistema
            exista, ETABS las descarta) y luego las LINEAS (X = letras A,B,C / Y =
            numeros 1,2,3, como NewGridOnly). Asi no hay cota de 1 m. Validado en
            vivo: ejes OK + cotas correctas sobre el modelo real, y secuencia
            completa en instancia nueva (9 lineas, ords 0,5,9,15,20 / 0,5,9,14).
            Regla 6 de la doc actualizada. Solo frontend (builder), sin servidor.
  - v3.21.0 GRILLA NO UNIFORME por defecto (pedido del usuario): la herramienta
            "1 · Crear grilla" del flujo guiado ya NO pide un solo espaciamiento
            X/Y; ahora se ingresan las LUCES (separaciones entre ejes consecutivos)
            como lista por vano: "Luces en X" = 5, 4, 6, 5 y "Luces en Y" = 5, 4, 5.
            gridParams paso de {lineasX, espaciamientoX,...} a {espaciamientosX,
            espaciamientosY} (strings). El nº de ejes y el ancho total se derivan
            (helper ordenadasDeLuces: luces -> ordenadas acumuladas desde 0).
            buildCurrentGridScript es HIBRIDO: si todas las luces de una direccion
            son iguales usa la ruta uniforme validada (NewGridOnly); si varian usa
            buildNonUniformGridBody (edita la tabla "Grid Definitions - Grid Lines",
            regla 6 de la doc). buildNonUniformGridBody ahora respeta altura tipica
            != altura 1er piso (NewGridOnly(N, htipica, hprimer, ...)). El preview
            (SvgPlanta/SvgElevacion) ya dibujaba cotas por vano -> se ve no uniforme
            al instante. Sin cambios de servidor. La herramienta "Grilla no uniforme"
            de la Biblioteca (por ordenadas absolutas) se mantiene.
  - v3.20.1 Mensaje claro cuando ETABS no conecta: si attach_etabs devuelve None
            aunque ETABS este abierto (perdio registro COM o tiene un dialogo que
            lo bloquea), el error ahora explica la recuperacion (cerrar dialogos /
            Mantenimiento > Cerrar procesos / reabrir el .EDB). Causa diagnosticada
            en vivo: GetObject Y GetObjectProcess(pid) devolvieron None = instancia
            colgada; el analisis en si ya estaba arreglado y corrido (v3.20.0).
  - v3.20.0 FIX análisis: "Correr análisis" fallaba si el modelo estaba sin
            guardar ("(Untitled)") — ETABS exige un .EDB en disco antes de
            RunAnalysis y el builder solo lanzaba error. Ahora si no hay archivo
            ni ruta, GUARDA AUTOMÁTICAMENTE en Documentos\\ETABS_API_modelos\\
            <proyecto>.EDB (buildAnalyzeBody con import os + nombreProyecto) y
            sigue con el análisis. Diagnóstico en vivo confirmó: modelo válido
            (CreateAnalysisModel ret=0), apoyos/masa/casos OK; solo faltaba guardar.
  - v3.19.0 MODELADOR losas poligonales + 3D editable + colores: (1) las LOSAS ya
            no son solo rectangulares: la herramienta Losa dibuja un POLÍGONO (3,
            4 o más vértices; cierra clicando el 1er punto o botón), guardado en
            `pts`; AddByCoord(N,...). Migración de losas rectangulares viejas. (2)
            En el 3D del Modelador se puede DIBUJAR (proyección inversa del clic al
            plano del nivel + snap a grilla; necesita la vista algo inclinada) y
            BORRAR (clic en el elemento). (3) Las GRILLAS se ven GRISES. (4) COLOR
            por SECCIÓN (colorDeSeccion, hash del nombre → HSL) en planta, 3D y
            árbol, como ETABS, para reconocer cada sección.
  - v3.18.0 MODELADOR grips + stories: (1) al seleccionar (tool Sel) aparecen los
            NODOS (grips, cuadros azules); clic en un nodo lo agarra y el siguiente
            clic lo reubica con snap → ESTIRA/ACORTA (vigas/muros endpoints + nodo
            medio mueve toda la línea; losa por esquinas; columna por su punto).
            Reusa modGrab + aplicarGrip. (2) Modo de PISOS al dibujar tipo ETABS:
            One story (solo el nivel activo) / Similar stories (niveles marcados) /
            All stories (todos): lo dibujado se REPLICA a esos niveles
            (crearEnNiveles, z por nivel). Estados storyMode + simStories.
  - v3.17.0 MODELADOR atajos/UX CAD: (1) escribir en cualquier parte (sin estar
            en un input) va a la BARRA DE COMANDOS y la enfoca (cmdRef), así los
            atajos se usan al instante. (2) SUPRIMIR (Delete) borra el elemento
            SELECCIONADO (ya no hace falta la herramienta Borrar). (3) UNDO/REDO
            real con historial: Ctrl+Z deshacer, Ctrl+Y / Ctrl+Shift+Z rehacer +
            botones. (4) el snap MEDIO ahora también da los puntos medios de la
            MALLA (centro de cada borde de grilla). (5) MOVER/COPIAR una distancia
            EXACTA: inputs dX/dY + Aplicar, o escribe "0.5,0" en el comando.
  - v3.16.0 MODELADOR tipo CAD pro (3 ejes pedidos): (A) ÁRBOL de objetos +
            PROPIEDADES editables (sección, nivel, coordenadas X/Y) + selección
            (tool Sel o árbol) con resaltado ámbar en planta y 3D + Borrar. (B)
            DIBUJO PRECISO: entrada por COORDENADAS escribiendo "x,y" en el
            comando, modo ORTO (horiz/vert), y COPIAR/ARRAY/ESPEJO/ROTAR
            (mapPts + fnEspejo/fnRot; array por filas×cols). (C) 3D con VISTAS
            predefinidas (Planta/Frente/Lado/Iso) y el elemento seleccionado
            resaltado en 3D. NO es un clon de FreeCAD (eso no es viable ni útil
            aquí): es el Modelador estructural acercado a un CAD profesional.
  - v3.15.0 MODELADOR look AutoCAD: barra de herramientas VERTICAL a la izquierda
            (iconos), panel de OPCIONES DE SNAP a la derecha (OSNAP on/off +
            toggles Grilla/Extremo/Medio; sin snap cercano = punto libre), línea
            de comando abajo a todo lo ancho, y nivel/sección/resumen/generar en
            el panel derecho. Nueva herramienta MOVER (MV/MO): clic un elemento
            (punto base) + clic destino → traslada (trasladar()). El snap ahora
            respeta los modos activos. Botón maximizar en la línea de comando.
  - v3.14.0 MODELADOR herramientas CAD: comandos tipo AutoCAD (escribe L/PL/C/M/
            LO/O/BR/ST/E + Enter, o botón); SNAP mejorado (intersección de
            grilla ◻, extremo ◻ rosa, punto medio △ de lo dibujado) con
            indicador por tipo; POLILÍNEA (PL) de vigas encadenadas (Esc termina);
            OFFSET (distancia + clic, copia paralela al lado del clic); BREAK
            (parte una viga/muro en el punto); STRETCH (agarra un extremo y lo
            reubica con snap); Esc cancela; y MAXIMIZAR la planta a pantalla
            completa. Coordenadas pasaron a metros (snap meter-based), así offset/
            break crean puntos fuera de grilla sin problema.
  - v3.13.0 MODELADOR + VISTA 3D viva: el Modelador suma una vista 3D (debajo de
            la planta) que se ACTUALIZA con lo que dibujas y se puede ROTAR.
            SvgGrilla3D gana prop `elementos`: dibuja columnas/vigas como lineas
            y losas/muros como poligonos con la MISMA proyeccion (rotan con la
            grilla); paneles detras, lineas delante; resalta el nivel activo.
  - v3.12.0 MODELADOR (mini-CAD): pestaña nueva e independiente "✏️ Modelador"
            para DIBUJAR sobre la grilla con herramientas estilo AutoCAD. Tools:
            Seleccionar / Columna (clic en intersección) / Viga y Muro (clic en
            2 puntos con snap a ejes) / Losa (clic en paño) / Borrar. Selector de
            sección por tipo (datalist con las creadas/detectadas) y selector de
            NIVEL activo (columnas/muros del nivel N-1→N; vigas/losas en N). Los
            elementos se guardan en localStorage y se dibujan en la planta del
            nivel. "Generar script ETABS" -> buildDibujoManualBody (FrameObj/
            AreaObj.AddByCoord, firmas validadas, verifica que las secciones
            existan) ensamblado en modo feed_current_model y abierto en Código
            para revisar/ejecutar. Template Python validado con py_compile.
  - v3.11.0 NAVEGAR entre niveles y ejes en Vista previa (como ETABS): la Planta
            tiene selector de NIVEL (▲/▼ + lista N0..Nn) y la Elevacion selector
            de EJE (◀/▶ + lista de ejes en Y [A,B,C, frame en X] y ejes en X
            [1,2,3, frame en Y]). La elevacion ya usa las ordenadas y etiquetas
            correctas segun el eje (SvgElevacion etiquetaEjes num/abc); el eje del
            corte se RESALTA en ambar en la planta (SvgPlanta resaltarX/Y) y el
            nivel+eje seleccionados se resaltan en el 3D (SvgGrilla3D nivelSelZ/
            ejeSel). Base para, en el futuro, mostrar vigas/losas por nivel y por
            eje. Estado nivelVista/ejeVista. Solo frontend (servidor v1.19.0).
  - v3.10.0 INTERACCION estilo ETABS en Vista previa: la vista 3D ahora GIRA
            (arrastrar = orbitar acimut/elevacion, rueda = zoom, doble clic
            reinicia; proyeccion yaw+pitch real en SvgGrilla3D, ya no isometrica
            fija). Planta y elevacion se MUEVEN con un envoltorio VistaInteractiva
            (pan arrastrando + zoom con rueda + doble clic reinicia). Y la
            ELEVACION ahora muestra SIEMPRE los ejes de grilla (verticales +
            burbujas A,B,C) y las lineas de nivel, aunque no se hayan dibujado
            los porticos (antes solo salian con conPorticos). Solo frontend.
  - v3.9.0  VISTA 3D de la grilla en la pestana "Vista previa": nuevo componente
            SvgGrilla3D (proyeccion isometrica determinista, sin librerias) con
            ejes X/Y, niveles de piso y columnas; tarjeta a todo lo ancho arriba
            de Planta/Elevacion. El selector de fuente de grilla suma la opcion
            "modelo real (diagnosticado)" -> 3D + planta + elevacion usan la
            grilla de diagData / del modelo leido (grilla_x/grilla_y/elevaciones/
            base_z). handleVistaLeerModelo guarda el resumen estructurado
            (vistaResumen). Solo frontend (servidor sin cambios, v1.19.0).
  - v3.8.0  GRILLA Y PISOS en el diagnostico: /etabs/diagnostico ahora extrae el
            sistema de grilla (ejes X/Y) y los pisos (nombres + elevaciones +
            base) via el helper extraer_geometria (compartido con model-summary,
            lee en metros). El panel muestra una banda "Sistema de grilla y
            pisos" y la caja CREAR GRILLA del diagrama indica "N pisos · ejes
            X×Y". Servidor v1.19.0.
  - v3.7.0  DIAGNOSTICO -> FLUJO: tras diagnosticar, cada caja del diagrama muestra
            lo DETECTADO en el modelo (concretos f'c, secciones bxh, losas e,
            patrones...) en vez de la descripcion estatica (detPasoTexto). Y los
            materiales detectados se REUSAN: los campos "Material concreto" /
            "Mat. refuerzo" de viga/columna/losas/muro son <input list=> con
            sugerencias (datalist mats-concreto/mats-acero) del material local +
            los detectados; al diagnosticar/leer, las secciones apuntan solo a un
            concreto que EXISTA en el modelo (aplicarMaterialesDetectados). Solo
            frontend (servidor sin cambios, sigue v1.18.0).
  - v3.6.0  INVENTARIO COMPLETO: el diagnostico ahora capta TODOS los materiales/
            secciones/losas/muros/patrones del modelo, INCLUIDOS los que trae
            ETABS por defecto (4000Psi, A615Gr60, A992Fy50, A416Gr270, Slab1...),
            marcados con la insignia "por defecto". Nueva tabla "Otros
            materiales" (acero estructural, tendon). El conteo de pasos sigue
            usando solo los del usuario (default=False), asi un modelo vacio no
            se auto-marca. Servidor v1.18.0 (cada item lleva "default": bool;
            otros_materiales con tipo+E). Validado en vivo. REINICIAR SERVIDOR.
  - v3.5.0  INVENTARIO RICO: "Diagnosticar" y "Leer modelo" ahora EXTRAEN las
            PROPIEDADES de cada elemento, no solo nombres. Servidor v1.17.0: una
            sola funcion extraer_inventario() (compartida por /etabs/diagnostico
            y /etabs/model-summary) lee en kgf-cm (unidad 14) -> materiales
            concreto (f'c + modulo E) y acero (Fy/Fu), secciones viga/columna
            (material + base x peralte en cm), losas maciza/1D/2D (tipo +
            espesor en cm; nervada/waffle toman el peralte de OverallDepth, no la
            losita) y muros (material + espesor), patrones y casos CON tipo, y
            combinaciones CON formula. El Diagnostico abre un PANEL visual con
            todo el inventario por tablas; formatModelSummary (lo que ve la IA)
            tambien incluye las propiedades. Validado en vivo 16/16 contra ETABS
            22 (runner_inventario_prod.py, instancia aislada). REINICIAR SERVIDOR.
*/

const APP_VERSION = 'v3.59.0';

// Version minima del servidor que esta interfaz necesita. Si el proceso
// corriendo es mas viejo, la app muestra un aviso para reiniciarlo
// (frontend nuevo + servidor viejo causaba errores confusos).
const EXPECTED_SERVER_VERSION = '1.31.0';

// Tabla compacta para el panel de Diagnostico (inventario rico del modelo).
function DiagBlock({ titulo, cols, filas, vacio = 'Sin elementos', accent = 'cyan' }) {
  const head = accent === 'emerald' ? 'text-emerald-300' : 'text-cyan-300';
  return (
    <div className="mb-3.5">
      <div className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${head}`}>{titulo}</div>
      {filas.length === 0 ? (
        <div className="text-[10px] text-slate-600 italic px-1">{vacio}</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-white/5">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-white/[0.04] text-slate-400">
                {cols.map((c, i) => <th key={i} className="text-left font-bold px-2.5 py-1.5">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className="border-t border-white/5">
                  {f.map((v, j) => <td key={j} className={`px-2.5 py-1.5 ${j === 0 ? 'font-bold text-white' : 'text-slate-300'}`}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Resumen corto de lo DETECTADO en el modelo para una caja del diagrama
// (se muestra en lugar de la descripcion estatica cuando hay diagnostico).
function detPasoTexto(id, g) {
  if (!g) return '';
  const join = (arr, f) => (arr || []).map(f).join(' · ');
  const u = arr => (arr || []).filter(x => !x.default);
  switch (id) {
    case 'grid': {
      const np = (g.pisos || []).length, ex = (g.grilla_x || []).length, ey = (g.grilla_y || []).length;
      return (np || ex || ey) ? `${np} pisos · ejes ${ex}×${ey}` : '';
    }
    case 'material': return join(u(g.concretos), c => `${c.nombre} ${c.fc ?? ''}`.trim());
    case 'acero': return join(u(g.aceros), a => `${a.nombre} Fy${a.fy ?? ''}`);
    case 'viga': return join(g.secciones_viga, s => `${s.nombre} ${s.base ?? '?'}×${s.peralte ?? '?'}`);
    case 'columna': return join(g.secciones_columna, s => `${s.nombre} ${s.base ?? '?'}×${s.peralte ?? '?'}`);
    case 'losa1d': return join(g.losas_1d, l => `${l.nombre} e${l.espesor ?? '?'}`);
    case 'losa2d': return join(g.losas_2d, l => `${l.nombre} e${l.espesor ?? '?'}`);
    case 'losamaciza': return join(g.losas_maciza, l => `${l.nombre} e${l.espesor ?? '?'}`);
    case 'muro': return join(g.muros, m => `${m.nombre} e${m.espesor ?? '?'}`);
    case 'patrones': return join(u(g.patrones), p => p.nombre);
    case 'casos': return join(g.casos, c => c.nombre);
    case 'combos': return (g.combinaciones || []).length ? `${g.combinaciones.length} combinaciones` : '';
    case 'espectro': return (g.casos || []).some(c => (c.nombre || '').toUpperCase().startsWith('CS')) ? 'CSX / CSY' : '';
    case 'porticos': case 'dibviga': case 'dibcolumna': return g.num_frames ? `${g.num_frames} elementos` : '';
    case 'dibujarlosa': case 'diblosa1d': case 'diblosa2d': case 'diblosamaciza': return g.num_areas ? `${g.num_areas} áreas` : '';
    case 'dibmuro': return g.num_areas ? `${g.num_areas} áreas` : '';
    case 'apoyos': return g.apoyos ? 'con apoyos' : '';
    case 'analizar': return g.analizado ? 'análisis corrido' : '';
    default: return '';
  }
}

// Color DETERMINISTA por nombre de seccion (como ETABS: cada sección su color).
function colorDeSeccion(sec) {
  const s = String(sec || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 72%, 60%)`;
}
// Puntos de una losa (poligonal). Compatibilidad con losas rectangulares viejas
// (x0,x1,y0,y1). Las nuevas guardan `pts: [{x,y}, ...]` (3, 4 o más).
function losaPts(el) {
  if (el.pts && el.pts.length >= 3) return el.pts;
  return [{ x: el.x0, y: el.y0 }, { x: el.x1, y: el.y0 }, { x: el.x1, y: el.y1 }, { x: el.x0, y: el.y1 }];
}

// Clave geometrica CANONICA de un elemento del Modelador: mismo tipo + nivel +
// coordenadas redondeadas = mismo elemento fisico. Sirve para comparar el dibujo
// con lo leido de ETABS (diff): lo que esta en el dibujo y no en ETABS = nuevo;
// lo que esta en ETABS y no en el dibujo = borrado.
function claveGeo(el) {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const p = (x, y) => `${r2(x)},${r2(y)}`;
  const L = el.nivel ?? 0;
  if (el.tipo === 'columna') return `col|${L}|${p(el.x, el.y)}`;
  if (el.tipo === 'viga' || el.tipo === 'muro') {
    const a = p(el.x1, el.y1), b = p(el.x2, el.y2);
    return `${el.tipo}|${L}|${[a, b].sort().join('~')}`;
  }
  if (el.tipo === 'losa') return `losa|${L}|${losaPts(el).map(q => p(q.x, q.y)).sort().join('~')}`;
  return `x|${el.id}`;
}

const GEMINI_MODEL_OPTIONS = [
  { value: 'gemini-flash-latest', label: 'Gemini Flash Latest', hint: 'Alias latest. Puede cambiar automaticamente.' },
  { value: 'gemini-pro-latest', label: 'Gemini Pro Latest', hint: 'Alias latest Pro, validar disponibilidad.' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', hint: 'Validar con Test modelo.' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', hint: 'Preview, validar disponibilidad.' },
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview', hint: 'Preview, validar disponibilidad.' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', hint: 'Validar disponibilidad.' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', hint: 'Preview, validar disponibilidad.' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Mas fuerte para razonamiento y codigo complejo.' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Recomendado para uso diario con ETABS.' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', hint: 'Rapido y economico.' },
  { value: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash Preview 09-2025', hint: 'Preview, validar disponibilidad.' },
  { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash-Lite Preview 09-2025', hint: 'Preview, validar disponibilidad.' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Modelo anterior.' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', hint: 'Modelo anterior ligero.' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', hint: 'Modelo anterior.' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', hint: 'Modelo anterior rapido.' },
  { value: 'custom', label: 'Personalizado', hint: 'Escribir manualmente otro ID de modelo Gemini.' }
];

const OPENAI_MODEL_OPTIONS = [
  { value: 'gpt-5.2', label: 'GPT-5.2', hint: 'Validar disponibilidad con tu API key.' },
  { value: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', hint: 'Validar disponibilidad con tu API key.' },
  { value: 'gpt-5', label: 'GPT-5', hint: 'Validar disponibilidad con tu API key.' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini', hint: 'Validar disponibilidad con tu API key.' },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano', hint: 'Validar disponibilidad con tu API key.' },
  { value: 'gpt-4.1', label: 'GPT-4.1', hint: 'Modelo fuerte para codigo.' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', hint: 'Rapido y economico.' },
  { value: 'gpt-4o', label: 'GPT-4o', hint: 'Flexible y multimodal.' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Alternativa economica.' },
  { value: 'custom', label: 'Personalizado', hint: 'Escribir manualmente otro ID de modelo OpenAI.' }
];

const ANTHROPIC_MODEL_OPTIONS = [
  { value: 'claude-fable-5', label: 'Claude Fable 5', hint: 'El mas reciente y capaz; ideal para el modo agente.' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'Muy fuerte en razonamiento y codigo.' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Equilibrado, rapido para uso diario.' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'Rapido y economico.' },
  { value: 'custom', label: 'Personalizado', hint: 'Escribir manualmente otro ID de modelo Claude.' }
];

// ============================================================
// FLUJO DE TRABAJO GUIADO (segun el esquema del usuario)
// Cada paso depende de otros; se desbloquea al completar los previos.
// fase agrupa visualmente; implementado=false muestra "proximamente".
// ============================================================
// Diagrama en MATRIZ (esquema del usuario): por cada elemento, las 3 etapas
// DEFINIR -> DIBUJAR -> CARGAR en columnas; abajo el tren de cargas/sismo;
// todo desemboca en CORRER ANALISIS. Columnas X: izq 10 / DEFINIR 235 /
// DIBUJAR 465 / CARGAR 695 / ANALISIS 945.
// Esquema reestructurado (v3.28.0) segun el diagrama del usuario:
//  MATERIALES -> [DEFINIR -> DIBUJAR -> CARGAR/ASIGNAR] x6 filas (viga/columna/losas/muro)
//  -> AUTOMESH + {DIAFRAGMA, END OFFSET, RELEASE} -> 1ER ANALISIS
//  -> {VERIFICAR SISTEMA, VERIFICAR IRREGULARIDADES} -> 2DO ANALISIS
//  Tren de cargas (abajo): PATRONES + MASS SOURCE + ESPECTRO -> CASOS -> COMBINACIONES.
// Los pasos NUEVOS sin script aun van con implementado:false (placeholder "Proximamente");
// no bloquean el flujo (ver stepDisponible) hasta que se implementen en vivo uno por uno.
const WORKFLOW_STEPS = [
  // MATERIALES (x=10): grilla (prerequisito) + concreto + acero
  { id: 'grid', num: 1, titulo: 'Crear grilla', desc: 'Ejes y pisos (prerequisito)', deps: [], implementado: true, pos: { x: 10, y: 15 } },
  { id: 'material', num: 2, titulo: 'Definir concreto', desc: "f'c (E por ACI)", deps: ['grid'], implementado: true, pos: { x: 10, y: 103 } },
  { id: 'acero', num: 3, titulo: 'Definir acero', desc: 'Fy refuerzo', deps: ['material'], implementado: true, pos: { x: 10, y: 177 } },
  // DEFINIR (x=235)
  { id: 'viga', num: 4, titulo: 'Definir seccion viga', desc: 'Seccion M3 (beam)', deps: ['acero'], implementado: true, pos: { x: 235, y: 15 } },
  { id: 'columna', num: 5, titulo: 'Definir seccion columna', desc: 'Seccion P-M2-M3', deps: ['acero'], implementado: true, pos: { x: 235, y: 89 } },
  { id: 'losa1d', num: 6, titulo: 'Definir losa alig. 1D', desc: 'Nervada', deps: ['acero'], implementado: true, pos: { x: 235, y: 163 } },
  { id: 'losa2d', num: 7, titulo: 'Definir losa alig. 2D', desc: 'Waffle', deps: ['acero'], implementado: true, pos: { x: 235, y: 237 } },
  { id: 'losamaciza', num: 8, titulo: 'Definir losa maciza', desc: 'Espesor constante', deps: ['acero'], implementado: true, pos: { x: 235, y: 311 } },
  { id: 'muro', num: 9, titulo: 'Definir muro', desc: 'Placa / muro de corte', deps: ['acero'], implementado: true, pos: { x: 235, y: 385 } },
  // DIBUJAR (x=465)
  { id: 'dibviga', num: 10, titulo: 'Dibujar viga', desc: 'Sobre la grilla', deps: ['viga'], implementado: true, pos: { x: 465, y: 15 } },
  { id: 'dibcolumna', num: 11, titulo: 'Dibujar columna', desc: 'En cada interseccion', deps: ['columna'], implementado: true, pos: { x: 465, y: 89 } },
  { id: 'diblosa1d', num: 12, titulo: 'Dibujar losa alig. 1D', desc: 'Panos en la grilla', deps: ['losa1d'], implementado: true, pos: { x: 465, y: 163 } },
  { id: 'diblosa2d', num: 13, titulo: 'Dibujar losa alig. 2D', desc: 'Panos en la grilla', deps: ['losa2d'], implementado: true, pos: { x: 465, y: 237 } },
  { id: 'diblosamaciza', num: 14, titulo: 'Dibujar losa maciza', desc: 'Panos en la grilla', deps: ['losamaciza'], implementado: true, pos: { x: 465, y: 311 } },
  { id: 'dibmuro', num: 15, titulo: 'Dibujar muro', desc: 'Paneles verticales', deps: ['muro'], implementado: true, pos: { x: 465, y: 385 } },
  // CARGAR / ASIGNAR (x=695) — grupo rojo del esquema; apoyos en la fila de columna
  { id: 'cargaviga', num: 16, titulo: 'Asignar carga en viga', desc: 'kgf/m CM/CV', deps: ['dibviga', 'patrones'], implementado: true, pos: { x: 695, y: 15 } },
  { id: 'apoyos', num: 17, titulo: 'Asignar apoyos', desc: 'Empotrado / articulado', deps: ['dibcolumna'], implementado: true, pos: { x: 695, y: 89 } },
  { id: 'cargalosa1d', num: 18, titulo: 'Cargar losa alig. 1D', desc: 'kgf/m2 CM/CV', deps: ['diblosa1d', 'patrones'], implementado: true, pos: { x: 695, y: 163 } },
  { id: 'cargalosa2d', num: 19, titulo: 'Cargar losa alig. 2D', desc: 'kgf/m2 CM/CV', deps: ['diblosa2d', 'patrones'], implementado: true, pos: { x: 695, y: 237 } },
  { id: 'cargalosamaciza', num: 20, titulo: 'Cargar losa maciza', desc: 'kgf/m2 CM/CV', deps: ['diblosamaciza', 'patrones'], implementado: true, pos: { x: 695, y: 311 } },
  { id: 'cargamuro', num: 21, titulo: 'Cargar muro', desc: 'Empuje de tierra CE', deps: ['dibmuro', 'patrones'], implementado: true, pos: { x: 695, y: 385 } },
  // ASIGNACIONES / MALLADO (x=925) — pasos NUEVOS (placeholder hasta implementar)
  { id: 'automesh', num: 22, titulo: 'Automesh losas y muros', desc: 'Cookie cut / rectangular', deps: ['apoyos'], implementado: true, pos: { x: 925, y: 89 } },
  { id: 'diafragma', num: 23, titulo: 'Asignar diafragma rigido', desc: 'Definir + asignar por punto', deps: ['automesh'], implementado: true, pos: { x: 925, y: 200 } },
  { id: 'endoffset', num: 24, titulo: 'End length offset', desc: 'Brazos rigidos viga/columna', deps: ['automesh'], implementado: true, pos: { x: 925, y: 274 } },
  { id: 'release', num: 25, titulo: 'Asignar release', desc: 'Liberaciones de extremo', deps: ['automesh'], implementado: true, pos: { x: 925, y: 348 } },
  // 1ER ANALISIS (x=1155). Mantiene id 'analizar' (handlers/forms intactos).
  { id: 'analizar', num: 26, titulo: 'Correr 1er analisis sismico', desc: 'Guardar + RunAnalysis', deps: ['apoyos', 'combos', 'automesh', 'diafragma', 'endoffset', 'release'], implementado: true, pos: { x: 1155, y: 200 } },
  // VERIFICACIONES (x=1385) — pasos NUEVOS
  { id: 'verifsistema', num: 27, titulo: 'Verificar sistema estructural', desc: 'Tipo de sistema E.030', deps: ['analizar'], implementado: true, pos: { x: 1385, y: 110 } },
  { id: 'verifirreg', num: 28, titulo: 'Verificar irregularidades sismicas', desc: 'Ia / Ip en altura y planta', deps: ['analizar'], implementado: true, pos: { x: 1385, y: 290 } },
  // 2DO ANALISIS (x=1615) — paso NUEVO
  { id: 'analizar2', num: 29, titulo: 'Correr 2do analisis sismico', desc: 'Re-analisis con R/factores ajustados', deps: ['verifsistema', 'verifirreg'], implementado: true, pos: { x: 1615, y: 200 } },
  // TREN DE CARGAS (abajo)
  // TREN DE CARGAS: cadena lineal "uno tras otro" (decisión del usuario):
  // Patrones → Mass Source → Espectro → Casos → Combinaciones → (1er análisis).
  { id: 'patrones', num: 30, titulo: 'Definir patrones de carga', desc: 'CM, CV, CE', deps: ['grid'], implementado: true, pos: { x: 10, y: 500 } },
  { id: 'masssource', num: 31, titulo: 'Mass Source', desc: 'Masa = factor·CM + factor·CV', deps: ['patrones'], implementado: true, pos: { x: 235, y: 500 } },
  { id: 'espectro', num: 32, titulo: 'Espectro de diseno', desc: 'E.030 + Ritz + CSX/CSY', deps: ['masssource'], implementado: true, pos: { x: 465, y: 500 } },
  { id: 'casos', num: 33, titulo: 'Definir casos de carga', desc: 'Modal · Sismo X · Sismo Y', deps: ['espectro'], implementado: true, automatico: true, pos: { x: 695, y: 500 } },
  { id: 'combos', num: 34, titulo: 'Definir combinaciones de carga', desc: 'E.060 peruano', deps: ['casos'], implementado: true, pos: { x: 925, y: 500 } }
];

const SESSION_MODES = [
  {
    value: 'attach_or_start_new_model',
    label: 'Auto: abrir/conectar y crear modelo',
    short: 'Auto + modelo nuevo',
    connection_mode: 'attach_or_start',
    model_mode: 'new_blank',
    instruction: 'El script debe intentar adjuntarse a un ETABS abierto (helper.GetObject) y VALIDAR la conexion con una llamada real (InitializeNewModel); si el attach o la validacion fallan, abrir una instancia nueva (helper.CreateObject con la ruta del exe, o CreateObjectProgID) + ApplicationStart. Usar el patron conectar_y_preparar_modelo de la documentacion.'
  },
  {
    value: 'start_new_instance_new_model',
    label: 'Abrir ETABS nuevo y crear modelo',
    short: 'Abrir ETABS',
    connection_mode: 'start',
    model_mode: 'new_blank',
    instruction: 'El script debe abrir SIEMPRE una nueva instancia de ETABS (CreateObjectProgID + ApplicationStart), luego InitializeNewModel(unidades) y crear el modelo.'
  },
  {
    value: 'attach_existing_new_model',
    label: 'Usar ETABS abierto y crear archivo nuevo',
    short: 'Abierto + nuevo',
    connection_mode: 'attach',
    model_mode: 'new_blank',
    instruction: 'El script debe adjuntarse a un ETABS YA abierto (helper.GetObject, sin abrir uno nuevo) y luego InitializeNewModel(unidades) para crear un modelo nuevo.'
  },
  {
    value: 'feed_current_model',
    label: 'Alimentar modelo actualmente abierto',
    short: 'Modelo actual',
    connection_mode: 'attach',
    model_mode: 'keep_current',
    instruction: 'El script debe adjuntarse a un ETABS abierto y trabajar sobre el modelo actual SIN InitializeNewModel ni File.NewBlank. No reiniciar ni borrar.'
  },
  {
    value: 'open_file_then_modify',
    label: 'Abrir archivo .EDB y modificar',
    short: 'Abrir .EDB',
    connection_mode: 'attach_or_start',
    model_mode: 'open_file',
    instruction: 'El script debe conectarse a ETABS y abrir el archivo .EDB indicado con SapModel.File.OpenFile(ruta), luego modificarlo.'
  },
  {
    value: 'code_only',
    label: 'Solo generar codigo, no ejecutar',
    short: 'Solo codigo',
    connection_mode: 'attach_or_start',
    model_mode: 'new_blank',
    instruction: 'Solo genera el script completo para revision o para correrlo manualmente en cmd. No se ejecutara desde la app.'
  }
];

// ============================================================
// ENSAMBLADOR DE SCRIPTS (composicion de bloques validados)
// La IA genera SOLO construir_modelo(sap_model); la app antepone
// el bloque base validado (conexion + utilidades + main) segun el
// modo. Asi la IA no puede romper la conexion nunca mas.
// ============================================================

function indentPython(code, spaces = 4) {
  const pad = ' '.repeat(spaces);
  return String(code || '').split('\n').map(l => (l.trim() ? pad + l : '')).join('\n');
}

function parseListaNumeros(texto) {
  return String(texto || '').split(/[,;\s]+/).map(Number).filter(n => Number.isFinite(n));
}

// ============================================================
// IMPORTAR EJES DESDE CAD (DXF) — parser AUTOCONTENIDO (sin deps, offline).
// El DWG es binario/cerrado: el usuario exporta a DXF (texto). Se leen las
// entidades LINE y LWPOLYLINE (segmentos) y se infieren los ejes: las lineas
// ortogonales LARGAS dan las luces X/Y; las inclinadas largas dan ejes inclinados.
// ============================================================
function parseDxfEntities(text) {
  // DXF ASCII = pares (codigo, valor) en lineas consecutivas. Soporta LINE, LWPOLYLINE
  // y POLYLINE (pesada, con sub-entidades VERTEX). Devuelve segmentos + conteo por capa.
  const raw = String(text).split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i].trim(), 10);
    if (!Number.isNaN(code)) pairs.push([code, raw[i + 1]]);
  }
  const segments = [];
  const layerCounts = {};
  const addSeg = (layer, x1, y1, x2, y2) => {
    if ([x1, y1, x2, y2].every(Number.isFinite) && (x1 !== x2 || y1 !== y2)) {
      segments.push({ layer, x1, y1, x2, y2 });
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    }
  };
  const readEnt = (start) => { // junta los pares de una entidad hasta el siguiente codigo 0
    let j = start; const got = [];
    while (j < pairs.length && pairs[j][0] !== 0) { got.push(pairs[j]); j++; }
    return { got, next: j };
  };
  let i = 0;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code !== 0) { i++; continue; }
    const tipo = (val || '').trim();
    if (tipo === 'LINE') {
      const { got, next } = readEnt(i + 1);
      let layer = '0', x1, y1, x2, y2;
      for (const [c, v] of got) { const n = parseFloat(v);
        if (c === 8) layer = (v || '').trim();
        else if (c === 10) x1 = n; else if (c === 20) y1 = n; else if (c === 11) x2 = n; else if (c === 21) y2 = n; }
      addSeg(layer, x1, y1, x2, y2); i = next;
    } else if (tipo === 'LWPOLYLINE') {
      const { got, next } = readEnt(i + 1);
      let layer = '0', closed = false, curX = null; const verts = [];
      for (const [c, v] of got) { const n = parseFloat(v);
        if (c === 8) layer = (v || '').trim();
        else if (c === 70) closed = (parseInt(v, 10) & 1) === 1;
        else if (c === 10) curX = n; else if (c === 20 && curX !== null) { verts.push([curX, n]); curX = null; } }
      const vs = (closed && verts.length) ? [...verts, verts[0]] : verts;
      for (let k = 0; k + 1 < vs.length; k++) addSeg(layer, vs[k][0], vs[k][1], vs[k + 1][0], vs[k + 1][1]);
      i = next;
    } else if (tipo === 'POLYLINE') {
      const { got, next } = readEnt(i + 1);
      let layer = '0';
      for (const [c, v] of got) if (c === 8) layer = (v || '').trim();
      let j = next; const verts = [];
      while (j < pairs.length && pairs[j][0] === 0) {
        const t2 = (pairs[j][1] || '').trim();
        if (t2 === 'VERTEX') {
          const r = readEnt(j + 1); let vx, vy;
          for (const [c, v] of r.got) { const n = parseFloat(v); if (c === 10) vx = n; else if (c === 20) vy = n; }
          if (Number.isFinite(vx) && Number.isFinite(vy)) verts.push([vx, vy]);
          j = r.next;
        } else { if (t2 === 'SEQEND') { j = readEnt(j + 1).next; } break; }
      }
      for (let k = 0; k + 1 < verts.length; k++) addSeg(layer, verts[k][0], verts[k][1], verts[k + 1][0], verts[k + 1][1]);
      i = j;
    } else { i++; }
  }
  return { segments, layers: Object.keys(layerCounts).sort(), layerCounts };
}

// Escala a METROS segun la unidad elegida ('m'|'cm'|'mm'|'auto'). En 'auto' se
// estima por el tamano del dibujo (los planos suelen estar en m o mm).
function dxfEscalaMetros(unidad, maxDim) {
  if (unidad === 'm') return 1;
  if (unidad === 'cm') return 0.01;
  if (unidad === 'mm') return 0.001;
  // auto: una planta tipica mide 5..200 m. Si el dibujo es enorme, esta en mm/cm.
  if (maxDim > 2000) return 0.001;   // mm
  if (maxDim > 400) return 0.01;     // cm
  return 1;                          // m
}

// Longitud de REFERENCIA de un grupo de líneas = el cluster de longitudes con MÁS
// miembros (los ejes comparten longitud; un membrete/recuadro son pocas líneas largas).
function dxfRefLen(arr) {
  if (!arr.length) return 0;
  const lens = arr.map(o => o.len).sort((a, b) => a - b);
  const tolL = (lens[lens.length - 1] * 0.05) || 1;
  let best = { c: lens[0], n: 0 };
  let cur = { c: lens[0], n: 1, sum: lens[0] };
  const flush = () => { if (cur.n > best.n || (cur.n === best.n && cur.c > best.c)) best = { c: cur.c, n: cur.n }; };
  for (let i = 1; i < lens.length; i++) {
    if (lens[i] - cur.c <= tolL) { cur.n++; cur.sum += lens[i]; cur.c = cur.sum / cur.n; }
    else { flush(); cur = { c: lens[i], n: 1, sum: lens[i] }; }
  }
  flush();
  return best.c;
}

// Caja envolvente (bounding box) de un grupo de segmentos {x1,y1,x2,y2}.
function dxfBBox(arr) {
  if (!arr.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of arr) {
    minX = Math.min(minX, o.x1, o.x2); maxX = Math.max(maxX, o.x1, o.x2);
    minY = Math.min(minY, o.y1, o.y2); maxY = Math.max(maxY, o.y1, o.y2);
  }
  return { minX, minY, maxX, maxY };
}

// De los SEGMENTOS del DXF infiere los ejes desde los PUNTOS reales (no asume grilla
// ortogonal): clasifica cada línea por su dirección PRINCIPAL — la que se extiende más en
// X es un eje "Y" (corre izq→der, etiquetas A,B,C…), la que se extiende más en Y es un eje
// "X" (1,2,3…). Toma la ORDENADA de cada eje en un BORDE de referencia (izquierdo/inferior),
// con lo que las luces salen bien aunque los ejes estén INCLINADOS; y los ejes inclinados
// (extremos con cota distinta) se devuelven con sus 2 puntos reales. capa: nombre o '(todas)'.
function extraerEjesDeDxf(segments, { capa = '(todas)', unidad = 'auto' } = {}) {
  let segs = segments;
  if (capa && capa !== '(todas)') segs = segs.filter(s => s.layer === capa);
  if (!segs.length) return { lucesX: [], lucesY: [], ejesInclinados: [], diag: 'sin líneas en esa capa', escala: 1, extent: null };

  // 1) Clasificar por dirección principal.
  const yLines = [], xLines = [];
  segs.forEach(s => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    if (Math.abs(dx) >= Math.abs(dy)) yLines.push({ ...s, len });   // se extiende en X -> eje Y
    else xLines.push({ ...s, len });                                 // se extiende en Y -> eje X
  });

  // 2) Quedarse con los ejes. Los LARGOS (>= 0.5·ref) son los confirmados y definen el
  //    RECUADRO de la grilla. Luego se RESCATAN las líneas CORTAS que caen DENTRO de ese
  //    recuadro: un eje real puede no cruzar toda la planta (p.ej. un eje intermedio /
  //    columna interior dibujado parcial). El recuadro evita colar líneas sueltas FUERA de
  //    la grilla (marca de origen, leaders). Sin esto se perdían ejes intermedios cortos
  //    (el usuario: "pusiste los inclinados pero falta el resto de los ejes").
  const refY = dxfRefLen(yLines), refX = dxfRefLen(xLines);
  const yLong = yLines.filter(o => refY > 0 && o.len >= 0.5 * refY);
  const xLong = xLines.filter(o => refX > 0 && o.len >= 0.5 * refX);
  const gridSize = Math.max(refX, refY, 1);
  const bbLong = dxfBBox([...yLong, ...xLong]);
  const margenBB = gridSize * 0.02;
  const dentroBB = (o) => bbLong &&
    Math.min(o.x1, o.x2) >= bbLong.minX - margenBB && Math.max(o.x1, o.x2) <= bbLong.maxX + margenBB &&
    Math.min(o.y1, o.y2) >= bbLong.minY - margenBB && Math.max(o.y1, o.y2) <= bbLong.maxY + margenBB;
  const rescatar = (lines, longSet, refDir) => {
    if (!longSet.length) return longSet;   // sin ejes largos no hay recuadro fiable
    const extra = lines.filter(o => !longSet.includes(o) && o.len >= 0.1 * refDir && dentroBB(o));
    return [...longSet, ...extra];
  };
  const yKept = rescatar(yLines, yLong, refY);
  const xKept = rescatar(xLines, xLong, refX);
  const escala = dxfEscalaMetros(unidad, gridSize);

  // 3) Borde de referencia: x del eje X más a la izquierda, y del eje Y más abajo.
  const flat = (k) => segs.flatMap(s => [s[k + '1'], s[k + '2']]);
  const xPos = xKept.map(o => (o.x1 + o.x2) / 2);
  const yPos = yKept.map(o => (o.y1 + o.y2) / 2);
  const xRef = xPos.length ? Math.min(...xPos) : Math.min(...flat('x'));
  const yRef = yPos.length ? Math.min(...yPos) : Math.min(...flat('y'));
  const yAt = (o, x) => { const dx = o.x2 - o.x1; return Math.abs(dx) < 1e-9 ? (o.y1 + o.y2) / 2 : o.y1 + ((x - o.x1) / dx) * (o.y2 - o.y1); };
  const xAt = (o, y) => { const dy = o.y2 - o.y1; return Math.abs(dy) < 1e-9 ? (o.x1 + o.x2) / 2 : o.x1 + ((y - o.y1) / dy) * (o.x2 - o.x1); };

  // 4) Ordenada de cada eje en el borde + marcar inclinados (extremos con cota distinta).
  const tol = gridSize * 0.012;       // fusiona ejes coincidentes
  const inclTol = gridSize * 0.008;   // umbral para considerar un eje inclinado
  let yA = yKept.map(o => ({ o, ord: yAt(o, xRef), incl: Math.abs(o.y2 - o.y1) > inclTol }));
  let xA = xKept.map(o => ({ o, ord: xAt(o, yRef), incl: Math.abs(o.x2 - o.x1) > inclTol }));
  const dedup = arr => {
    arr.sort((a, b) => a.ord - b.ord);
    const out = [];
    for (const it of arr) {
      if (out.length && Math.abs(it.ord - out[out.length - 1].ord) <= tol) {
        if (it.incl && !out[out.length - 1].incl) out[out.length - 1] = it;   // preferir el inclinado
      } else out.push(it);
    }
    return out;
  };
  yA = dedup(yA); xA = dedup(xA);

  const r2 = x => Math.round(x * 1e3) / 1e3;
  const lucesY = yA.slice(1).map((it, i) => r2((it.ord - yA[i].ord) * escala)).filter(d => d > 0);
  const lucesX = xA.slice(1).map((it, i) => r2((it.ord - xA[i].ord) * escala)).filter(d => d > 0);

  // 5) Ejes inclinados con sus 2 puntos reales, en coords de planta (origen = 1er eje).
  const ox = xA.length ? xA[0].ord : xRef;
  const oy = yA.length ? yA[0].ord : yRef;
  const ei = [];
  const pushPts = (id, X1, Y1, X2, Y2) => {
    const p1 = [r2((X1 - ox) * escala), r2((Y1 - oy) * escala)];
    const p2 = [r2((X2 - ox) * escala), r2((Y2 - oy) * escala)];
    const [a, b] = (p1[0] < p2[0] || (p1[0] === p2[0] && p1[1] <= p2[1])) ? [p1, p2] : [p2, p1];
    ei.push({ id, x1: String(a[0]), y1: String(a[1]), x2: String(b[0]), y2: String(b[1]), bubble: 'Start' });
  };
  // 5a) Bordes inclinados (extremos con cota distinta) -> EI1, EI2...
  yA.forEach(it => { if (it.incl) pushPts(`EI${ei.length + 1}`, it.o.x1, it.o.y1, it.o.x2, it.o.y2); });
  xA.forEach(it => { if (it.incl) pushPts(`EI${ei.length + 1}`, it.o.x1, it.o.y1, it.o.x2, it.o.y2); });
  // 5b) PLANTA TRAPEZOIDAL: si una dirección tiene sus DOS ejes extremos inclinados (bordes
  //     sup/inf o izq/der no horizontales), los ejes PERPENDICULARES se devuelven también como
  //     ejes de 2 puntos que TERMINAN/INICIAN en esos bordes (pedido del usuario: A,B,C deben
  //     cerrar contra los inclinados, no extenderse a ejes ortogonales rectos). Las luces se
  //     mantienen (origen/elevación intactos); en el dibujo, las líneas ortogonales que coinciden
  //     con un inclinado se OCULTAN (SvgPlanta) -> los extremos rectos 1/5 desaparecen.
  const skewY = yA.length >= 3 && yA[0].incl && yA[yA.length - 1].incl;
  const skewX = xA.length >= 3 && xA[0].incl && xA[xA.length - 1].incl;
  if (skewY) {
    const eBot = yA[0].o, eTop = yA[yA.length - 1].o;   // bordes inferior/superior inclinados
    xA.forEach((it, i) => { if (it.incl) return; const x = it.ord; pushPts(String.fromCharCode(65 + i), x, yAt(eBot, x), x, yAt(eTop, x)); });
  }
  if (skewX) {
    const eL = xA[0].o, eR = xA[xA.length - 1].o;       // bordes izquierdo/derecho inclinados
    yA.forEach((it, i) => { if (it.incl) return; const y = it.ord; pushPts(String(i + 1), xAt(eL, y), y, xAt(eR, y), y); });
  }

  return {
    lucesX, lucesY, ejesInclinados: ei, escala, skew: skewX || skewY,
    extent: { W: r2(refY), H: r2(refX) },
    diag: `${segs.length} líneas → ${xA.length} eje(s) X, ${yA.length} eje(s) Y, ${ei.length} eje(s) de 2 puntos${skewX || skewY ? ' (planta trapezoidal)' : ''}`
  };
}

// Convierte una lista de LUCES (separaciones entre ejes consecutivos) en
// ordenadas acumuladas desde 0. "5, 4, 6" -> [0, 5, 9, 15] (4 ejes). Asi el
// ingeniero piensa en tramos (luces), no en coordenadas absolutas.
function ordenadasDeLuces(texto) {
  const luces = parseListaNumeros(texto).filter(n => n > 0);
  const ords = [0];
  for (const s of luces) ords.push(Number((ords[ords.length - 1] + s).toFixed(4)));
  return ords;
}

const BASE_UTILS = `import comtypes.client
import time

RUTA_ETABS = r"C:\\Program Files\\Computers and Structures\\ETABS 22\\ETABS.exe"


def verificar_retorno(ret, accion):
    if ret != 0:
        raise RuntimeError(
            f"Error en {accion}. Codigo ret={ret}. "
            "ETABS RECHAZO la operacion (no es un crash): revisa que los nombres "
            "usados existan en el modelo y que los valores sean validos."
        )


def reintentar(funcion, accion, intentos=3, espera=2.0):
    # La primera llamada que crea modelo tras reutilizar una instancia puede
    # fallar transitoriamente ('Object reference not set'). Reintentar lo cura.
    ultimo = None
    for i in range(intentos):
        try:
            return funcion()
        except Exception as e:
            ultimo = e
            print(f"{accion}: intento {i + 1} fallo ({e}). Reintento en {espera}s...")
            time.sleep(espera)
    raise RuntimeError(f"{accion}: fallo tras {intentos} intentos. Ultimo error: {ultimo}")


def iniciar_etabs_nuevo():
    # CreateObject puede devolver None sin lanzar excepcion: validar siempre.
    helper = comtypes.client.CreateObject("ETABSv1.Helper")
    etabs = None
    try:
        etabs = helper.CreateObject(RUTA_ETABS)
    except Exception:
        etabs = None
    if etabs is None:
        etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
    if etabs is None:
        raise RuntimeError("No se pudo crear la instancia de ETABS. Verifica RUTA_ETABS.")
    ret = etabs.ApplicationStart()
    verificar_retorno(ret, "Iniciar ETABS")
    return etabs


def attach_etabs():
    # Adjunta a ETABS. Si PID_OBJETIVO > 0, a esa instancia EXACTA
    # (helper.GetObjectProcess); si es 0, a la instancia registrada (GetObject).
    helper = comtypes.client.CreateObject("ETABSv1.Helper")
    try:
        if PID_OBJETIVO and int(PID_OBJETIVO) > 0:
            return helper.GetObjectProcess("CSI.ETABS.API.ETABSObject", int(PID_OBJETIVO))
        return helper.GetObject("CSI.ETABS.API.ETABSObject")
    except Exception:
        return None
`;

function buildConnectionFunction(modeValue) {
  if (modeValue === 'start_new_instance_new_model') {
    return `def conectar_y_preparar_modelo(unidades):
    etabs = iniciar_etabs_nuevo()
    sap_model = etabs.SapModel
    ret = sap_model.InitializeNewModel(unidades)
    verificar_retorno(ret, "Inicializar modelo nuevo")
    return etabs, sap_model
`;
  }
  if (modeValue === 'attach_existing_new_model') {
    return `def conectar_y_preparar_modelo(unidades):
    etabs = attach_etabs()
    if etabs is None:
        raise RuntimeError("No hay ETABS abierto. Abre ETABS o usa el modo Auto.")
    sap_model = etabs.SapModel
    ret = sap_model.InitializeNewModel(unidades)
    verificar_retorno(ret, "Inicializar modelo")
    time.sleep(1.0)  # dar tiempo a ETABS a reacomodar la interfaz
    print("Usando ETABS ya abierto (conexion validada).")
    return etabs, sap_model
`;
  }
  if (modeValue === 'feed_current_model') {
    return `def conectar_y_preparar_modelo(unidades):
    etabs = attach_etabs()
    if etabs is None:
        raise RuntimeError(
            "No se pudo CONECTAR con ETABS. Si ETABS esta abierto pero igual sale "
            "este error, la instancia perdio su registro COM o tiene un DIALOGO "
            "abierto que la bloquea. SOLUCION: 1) cierra cualquier ventana/dialogo "
            "dentro de ETABS; 2) si sigue, usa Biblioteca > Mantenimiento > Cerrar "
            "procesos ETABS y vuelve a ABRIR tu modelo (.EDB); 3) reintenta. "
            "(Si aun no hay modelo, crea la grilla en el paso 1.)"
        )
    sap_model = etabs.SapModel
    # VALIDACION ANTI-FANTASMA: en una instancia viva GetModelFilename devuelve
    # un texto (p.ej. '(Untitled)'); None significa proceso colgado.
    nombre = sap_model.GetModelFilename()
    if nombre is None:
        raise RuntimeError(
            "La instancia de ETABS registrada esta COLGADA (proceso fantasma). "
            "Usa Herramientas > Mantenimiento > Cerrar procesos ETABS, abre tu "
            "modelo de nuevo y reintenta."
        )
    print(f"Conectado al modelo actual: {nombre}")
    return etabs, sap_model
`;
  }
  if (modeValue === 'open_file_then_modify') {
    return `def conectar_y_preparar_modelo(unidades):
    etabs = None
    try:
        candidato = attach_etabs()
        if candidato is not None:
            # Anti-fantasma: en instancia viva GetModelFilename NUNCA es None.
            if candidato.SapModel.GetModelFilename() is None:
                raise RuntimeError("instancia colgada (GetModelFilename=None)")
            etabs = candidato
            print("Usando ETABS ya abierto.")
    except Exception as e:
        print(f"Sin instancia utilizable ({e}).")
    if etabs is None:
        print("Abriendo ETABS nuevo...")
        etabs = iniciar_etabs_nuevo()
    sap_model = etabs.SapModel
    ret = reintentar(lambda: sap_model.File.OpenFile(RUTA_EDB), "Abrir archivo EDB")
    verificar_retorno(ret, "Abrir archivo EDB")
    return etabs, sap_model
`;
  }
  // attach_or_start_new_model (Auto) y code_only:
  return `def conectar_y_preparar_modelo(unidades):
    # Anti proceso colgado: el attach se VALIDA con una llamada real; si la
    # instancia no sirve, se abre una nueva. attach_etabs puede devolver None.
    try:
        etabs = attach_etabs()
        if etabs is None:
            raise RuntimeError("No hay instancia de ETABS abierta.")
        sap_model = etabs.SapModel
        ret = sap_model.InitializeNewModel(unidades)
        verificar_retorno(ret, "Inicializar modelo")
        time.sleep(1.0)  # dar tiempo a ETABS a reacomodar la interfaz
        print("Usando ETABS ya abierto (conexion validada).")
        return etabs, sap_model
    except Exception as e:
        print(f"Sin instancia utilizable ({e}). Abriendo ETABS nuevo...")
    etabs = iniciar_etabs_nuevo()
    sap_model = etabs.SapModel
    ret = sap_model.InitializeNewModel(unidades)
    verificar_retorno(ret, "Inicializar modelo nuevo")
    return etabs, sap_model
`;
}

function assembleScript({ modeValue, unidades = 6, modelPath = '', body }) {
  const keepCurrent = modeValue === 'feed_current_model';
  const rutaEdb = modeValue === 'open_file_then_modify'
    ? `RUTA_EDB = r"${String(modelPath || '').replace(/"/g, '')}"\n`
    : '';

  const header = `# ============================================================
# BLOQUE BASE VALIDADO (generado automaticamente por la app)
# Conexion, utilidades y main() provienen de plantillas probadas.
# Funciona igual ejecutado desde cmd: python archivo.py
# ============================================================
${BASE_UTILS}
UNIDADES = ${unidades}
PID_OBJETIVO = 0   # instancia ETABS objetivo (0 = la registrada); la app la inyecta
${rutaEdb}

${buildConnectionFunction(modeValue)}

# ============================================================
# CODIGO DE MODELADO
# ============================================================

`;

  const footer = `

def main():
    print("Conectando a ETABS...")
    etabs, sap_model = conectar_y_preparar_modelo(UNIDADES)
    construir_modelo(sap_model)
${keepCurrent ? '' : `    ret = sap_model.SetPresentUnits(UNIDADES)
    verificar_retorno(ret, "Definir unidades visibles")
`}    print("Script completado. ETABS queda abierto.")


if __name__ == "__main__":
    main()
`;

  return header + body.trim() + footer;
}

function assembleGeneratedScript({ modeValue, unidades, modelPath, aiCode }) {
  let body = String(aiCode || '').replace(/^```(python)?/gm, '').replace(/```/g, '').trim();

  // Si la IA desobedecio y devolvio un script completo, usarlo tal cual:
  // el preflight y la validacion del servidor lo revisaran igual.
  const looksFullScript = /import\s+comtypes|ApplicationStart\s*\(|if\s+__name__/.test(body);
  const hasConstruir = /def\s+construir_modelo\s*\(/.test(body);
  if (looksFullScript && !hasConstruir) {
    return { script: body, usedBase: false };
  }

  if (!hasConstruir) {
    body = `def construir_modelo(sap_model):\n${indentPython(body || 'print("Sin acciones de modelado.")')}`;
  }
  return { script: assembleScript({ modeValue, unidades, modelPath, body }), usedBase: true };
}

// Cuerpo del DIBUJO MANUAL (Modelador estilo CAD): coloca columnas, vigas,
// losas y muros en coordenadas EXPLICITAS (metros) con AddByCoord (firmas
// validadas: columna/viga = FrameObj; losa/muro panel vertical = AreaObj 4 pts).
// `borrar` (sincronizacion, v3.21.8): [{tipo, name}] = elementos que estaban en
// ETABS y se quitaron del Modelador -> se borran por su nombre (FrameObj/AreaObj.Delete).
function buildDibujoManualBody({ columnas = [], vigas = [], losas = [], muros = [], borrar = [], desbloquear = false }) {
  const f = n => { const s = Number(n).toFixed(3).replace(/\.?0+$/, ''); return s === '' || s === '-0' ? '0' : s; };
  const col = columnas.map(c => `        (${f(c.x)}, ${f(c.y)}, ${f(c.zBot)}, ${f(c.zTop)}, "${c.sec}"),`).join('\n');
  const vig = vigas.map(v => `        (${f(v.x1)}, ${f(v.y1)}, ${f(v.x2)}, ${f(v.y2)}, ${f(v.z)}, "${v.sec}"),`).join('\n');
  const los = losas.map(l => {
    const ps = (l.pts && l.pts.length >= 3) ? l.pts : [{ x: l.x0, y: l.y0 }, { x: l.x1, y: l.y0 }, { x: l.x1, y: l.y1 }, { x: l.x0, y: l.y1 }];
    return `        ([${ps.map(q => f(q.x)).join(', ')}], [${ps.map(q => f(q.y)).join(', ')}], ${f(l.z)}, "${l.sec}"),`;
  }).join('\n');
  const mur = muros.map(m => `        (${f(m.x1)}, ${f(m.y1)}, ${f(m.x2)}, ${f(m.y2)}, ${f(m.zBot)}, ${f(m.zTop)}, "${m.sec}"),`).join('\n');
  const pyNombres = arr => arr.filter(Boolean).map(s => `"${String(s).replace(/"/g, '')}"`).join(', ');
  const borrarFrames = pyNombres(borrar.filter(b => b.tipo === 'columna' || b.tipo === 'viga').map(b => b.name));
  const borrarAreas = pyNombres(borrar.filter(b => b.tipo === 'losa' || b.tipo === 'muro').map(b => b.name));
  return `def construir_modelo(sap_model):
    # === DIBUJO MANUAL / SINCRONIZAR (Modelador estilo CAD, coordenadas en metros) ===
    sap_model.SetPresentUnits(8)   # kgf, m, C
${desbloquear ? '    sap_model.SetModelIsLocked(False)   # desbloquear (el analisis se descarta)\n' : ''}

    def desanidar(r):
        p = list(r) if isinstance(r, (list, tuple)) else [r]
        while len(p) == 1 and isinstance(p[0], (list, tuple)):
            p = list(p[0])
        return p

    def ret_de(p):
        e = [x for x in p if isinstance(x, int) and not isinstance(x, bool)]
        return e[-1] if e else -1

    COLUMNAS = [
${col}
    ]
    VIGAS = [
${vig}
    ]
    LOSAS = [
${los}
    ]
    MUROS = [
${mur}
    ]
    BORRAR_FRAMES = [${borrarFrames}]   # nombres de columnas/vigas quitadas en el Modelador
    BORRAR_AREAS = [${borrarAreas}]     # nombres de losas/muros quitados

    # 0) BORRAR los elementos que se quitaron del Modelador (por su nombre en ETABS).
    borrados = 0
    for nm in BORRAR_FRAMES:
        try:
            if ret_de(desanidar(sap_model.FrameObj.Delete(nm, 0))) == 0: borrados += 1
        except Exception: pass
    for nm in BORRAR_AREAS:
        try:
            if ret_de(desanidar(sap_model.AreaObj.Delete(nm, 0))) == 0: borrados += 1
        except Exception: pass

    res = desanidar(sap_model.PropFrame.GetNameList(0, []))
    sec_frame = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    res = desanidar(sap_model.PropArea.GetNameList(0, []))
    sec_area = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]

    creados, errores = 0, 0
    for (x, y, zb, zt, sec) in COLUMNAS:
        if sec not in sec_frame:
            raise RuntimeError("La seccion de columna '%s' no existe. Definela primero." % sec)
        r = desanidar(sap_model.FrameObj.AddByCoord(x, y, zb, x, y, zt, "", sec, "", "Global"))
        if ret_de(r) == 0: creados += 1
        else: errores += 1
    for (x1, y1, x2, y2, z, sec) in VIGAS:
        if sec not in sec_frame:
            raise RuntimeError("La seccion de viga '%s' no existe. Definela primero." % sec)
        r = desanidar(sap_model.FrameObj.AddByCoord(x1, y1, z, x2, y2, z, "", sec, "", "Global"))
        if ret_de(r) == 0: creados += 1
        else: errores += 1
    for (xs_l, ys_l, z, sec) in LOSAS:
        if sec not in sec_area:
            raise RuntimeError("La losa '%s' no existe. Definela primero." % sec)
        zs = [z] * len(xs_l)
        r = desanidar(sap_model.AreaObj.AddByCoord(len(xs_l), xs_l, ys_l, zs, "", sec, "", "Global"))
        if ret_de(r) == 0: creados += 1
        else: errores += 1
    for (x1, y1, x2, y2, zb, zt, sec) in MUROS:
        if sec not in sec_area:
            raise RuntimeError("El muro '%s' no existe. Definelo primero." % sec)
        xs = [x1, x2, x2, x1]; ys = [y1, y2, y2, y1]; zs = [zb, zb, zt, zt]
        r = desanidar(sap_model.AreaObj.AddByCoord(4, xs, ys, zs, "", sec, "", "Global"))
        if ret_de(r) == 0: creados += 1
        else: errores += 1

    sap_model.View.RefreshView(0, False)
    print("SINCRONIZACION: %d creados, %d borrados, %d con error." % (creados, borrados, errores))`;
}

// Etiqueta de eje estilo ETABS: 0->A, 1->B, ..., 25->Z, 26->AA (como NewGridOnly).
function etiquetaEjeAlfabetica(indice) {
  let i = Math.floor(indice), s = '';
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
  return s;
}

// Cuerpo del flujo de grilla NO uniforme — API PURA, EN MEMORIA, SIN ARCHIVOS
// (decisión del usuario, 2026-06-13). VALIDADO EN VIVO en ETABS 22.
// CLAVE 1: desanidar() — comtypes envuelve las salidas en UNA lista anidada.
// CLAVE 2 (las COTAS): se investigó a fondo y la API COM de ETABS 22 NO expone una
// forma de crear la grilla no uniforme CON las cotas de espaciamiento en memoria:
// no hay SetGridSysCartesian (cGridSys solo SetGridSys=origen), la tabla Grid Lines
// solo tiene Ordinate (editarla mueve los ejes pero NO regenera las cotas, que ETABS
// cachea en el EDB binario), y no hay API de "dimension lines" ni de regenerar. Las
// cotas solo las genera NewGridOnly (uniforme), el GUI "Custom Grid Spacing" o cargar
// un .e2k de texto. El usuario eligió API pura SIN cotas (geometría correcta), antes
// que importar/exportar e2k. Por eso: NewBlank (modelo vacío) + PISOS por API
// (SetStories_2) + GRILLA por Database Tables (GENERAL antes que GRID LINES; si las
// líneas se escriben sin que el sistema exista, ETABS las descarta) + ENCUADRE con 2
// PUNTOS de esquina temporales que se borran (Count->0, no afectan apoyos/diagnóstico).
// Validado en vivo: ejes A-E/1-4 no uniformes, plano encuadrado, sin cotas.
// Alturas POR PISO estilo Tekla: "4 5 5" o "4 2*5" -> [4, 5, 5] (abajo->arriba, la 1a
// entrada es el primer piso). Soporta multiplicador n*h (o n x h) y separadores espacio/coma.
function parseAlturasPisos(texto) {
  const out = [];
  String(texto || '').split(/[,;\s]+/).filter(Boolean).forEach(tok => {
    const m = tok.match(/^(\d+)\s*[*x]\s*([\d.]+)$/i);   // n*h -> n pisos de altura h
    if (m) {
      const n = parseInt(m[1], 10), h = parseFloat(m[2]);
      if (Number.isFinite(h) && h > 0) for (let i = 0; i < n && out.length < 200; i++) out.push(h);
    } else {
      const h = parseFloat(tok);
      if (Number.isFinite(h) && h > 0) out.push(h);
    }
  });
  return out;
}

// Cotas Z acumuladas desde 0 a partir de las alturas por piso: [4,5,5] -> [0,4,9,14].
function nivelesDeAlturas(alturas) {
  const z = [0];
  (alturas || []).forEach(h => z.push(Number((z[z.length - 1] + Number(h)).toFixed(4))));
  return z;
}

function buildNonUniformGridBody({ numeroPisos, alturaTipica, alturaPrimerPiso, alturaPiso, alturasPiso, ordenadasX, ordenadasY, ejesInclinados = [] }) {
  // Alturas POR PISO (abajo->arriba). El flujo guiado pasa alturasPiso (lista explicita,
  // estilo Tekla); compat: la Biblioteca pasa alturaPiso (una sola) o alturaTipica+1erPiso.
  let alturas;
  if (Array.isArray(alturasPiso) && alturasPiso.length) {
    alturas = alturasPiso.map(Number).filter(h => h > 0);
  } else {
    const hT = Number(alturaTipica ?? alturaPiso ?? 3);
    const hP = Number(alturaPrimerPiso ?? alturaPiso ?? hT);
    const n = Math.max(1, Math.round(Number(numeroPisos) || 1));
    alturas = [hP, ...Array.from({ length: n - 1 }, () => hT)];
  }
  if (!alturas.length) alturas = [3];
  const N = alturas.length;
  const pyLista = (arr) => '[' + arr.map(v => `"${v}"`).join(', ') + ']';
  // Ejes inclinados (regla 32 de la doc): lineas "General (Cartesian)" por 2 puntos.
  let ejesInc = (ejesInclinados || []).filter(
    e => [e.x1, e.y1, e.x2, e.y2].every(v => Number.isFinite(Number(v))) &&
      (Number(e.x1) !== Number(e.x2) || Number(e.y1) !== Number(e.y2)))
    .map((e, i) => ({ id: String(e.id || `EI${i + 1}`), x1: Number(e.x1), y1: Number(e.y1), x2: Number(e.x2), y2: Number(e.y2), bubble: e.bubble === 'End' ? 'End' : 'Start' }));
  // DEDUP (planta trapezoidal): un eje ORTOGONAL que coincide con un eje inclinado/general es
  // REDUNDANTE (lo reemplaza el inclinado) -> se OMITE. Si no, ETABS dibuja la grilla recta
  // ENCIMA del trapecio (el usuario: "en etabs debe ser lo mismo" que la vista previa).
  const genV = ejesInc.filter(e => Math.abs(e.x2 - e.x1) <= Math.abs(e.y2 - e.y1));   // verticales
  const genH = ejesInc.filter(e => Math.abs(e.x2 - e.x1) > Math.abs(e.y2 - e.y1));    // horizontales
  const allX = [...ordenadasX, ...ejesInc.flatMap(e => [e.x1, e.x2])];
  const allY = [...ordenadasY, ...ejesInc.flatMap(e => [e.y1, e.y2])];
  const minX = Math.min(...allX), maxX = Math.max(...allX), minY = Math.min(...allY), maxY = Math.max(...allY);
  const tolG = 0.03 * Math.max(maxX - minX, maxY - minY, 1);
  let ordX = [], idsX = [], ordY = [], idsY = [];
  ordenadasX.forEach((o, i) => { if (!genV.some(e => Math.abs((e.x1 + e.x2) / 2 - o) <= tolG)) { ordX.push(o); idsX.push(etiquetaEjeAlfabetica(i)); } });
  ordenadasY.forEach((o, i) => { if (!genH.some(e => Math.abs((e.y1 + e.y2) / 2 - o) <= tolG)) { ordY.push(o); idsY.push(String(i + 1)); } });
  // Si una direccion queda SIN ejes ortogonales (todos pasaron a inclinados), los ortogonales que
  // quedan en la OTRA direccion no tendrian extension -> se convierten tambien a generales (2 puntos,
  // abarcando el ancho/fondo de la grilla) -> grilla 100% "General", fiel al trapecio.
  if (ordX.length === 0 && ordY.length) {
    ordY.forEach((o, i) => ejesInc.push({ id: idsY[i], x1: minX, y1: o, x2: maxX, y2: o, bubble: 'Start' }));
    ordY = []; idsY = [];
  } else if (ordY.length === 0 && ordX.length) {
    ordX.forEach((o, i) => ejesInc.push({ id: idsX[i], x1: o, y1: minY, x2: o, y2: maxY, bubble: 'End' }));
    ordX = []; idsX = [];
  }
  const ejesBlock = ejesInc.length
    ? 'EJES_INC = [\n' + ejesInc.map(e =>
      `        ("${e.id.replace(/"/g, '')}", ${e.x1}, ${e.y1}, ${e.x2}, ${e.y2}, "${e.bubble}"),`
    ).join('\n') + '\n    ]'
    : 'EJES_INC = []';
  return `def construir_modelo(sap_model):
    ORDENADAS_X = [${ordX.join(', ')}]
    ORDENADAS_Y = [${ordY.join(', ')}]
    IDS_X = ${pyLista(idsX)}
    IDS_Y = ${pyLista(idsY)}
    NUMERO_PISOS = ${N}
    ALTURAS = [${alturas.map(h => Number(h).toFixed(2)).join(', ')}]   # altura de cada piso (abajo->arriba)
    # Ejes inclinados: (ID, X1, Y1, X2, Y2, BubbleLoc) -> linea "General (Cartesian)" por 2 puntos.
    ${ejesBlock}
    GRID = "G1"
    GEN = "Grid Definitions - General"
    LINES = "Grid Definitions - Grid Lines"

    def desanidar(resultado):
        # comtypes envuelve los parametros de salida en una lista unica.
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ultimo_int(res):
        ints = [p for p in res if isinstance(p, int) and not isinstance(p, bool)]
        return ints[-1] if ints else -1

    # 1) MODELO EN BLANCO (API pura, sin archivos).
    verificar_retorno(reintentar(lambda: sap_model.File.NewBlank(), "Crear modelo en blanco"),
                      "Crear modelo en blanco")

    # 2) PISOS por API. Story1 = primer piso (abajo); el ultimo es el master.
    #    SetStories_2(base, n, nombres, alturas, esMaster, similar, splice, hsplice, color).
    nombres = ["Story%d" % i for i in range(1, NUMERO_PISOS + 1)]
    alturas = ALTURAS   # altura explicita de cada piso (abajo->arriba)
    es_master = [False] * (NUMERO_PISOS - 1) + [True]
    res_st = desanidar(sap_model.Story.SetStories_2(
        0.0, NUMERO_PISOS, nombres, alturas, es_master,
        ["None"] * NUMERO_PISOS, [False] * NUMERO_PISOS, [0.0] * NUMERO_PISOS, [0] * NUMERO_PISOS))
    verificar_retorno(ultimo_int(res_st), "Crear pisos")

    db = sap_model.DatabaseTables

    # 3a) GRILLA via tabla GENERAL (define el sistema). DEBE ir antes que las lineas:
    #     si las lineas se escriben sin que el sistema exista, ETABS las descarta.
    pg = desanidar(db.GetTableForEditingArray(GEN, "", 0, [], 0, []))
    campos_g = [str(c) for c in pg[1]]
    idxg = {c: i for i, c in enumerate(campos_g)}
    fila_g = [""] * len(campos_g)
    for col, val in (("Tower", "T1"), ("Name", GRID), ("Type", "Cartesian"),
                     ("Ux", "0"), ("Uy", "0"), ("Rz", "0"),
                     ("StoryRange", "Default"), ("BubbleSize", "1.25"), ("Color", "Gray6")):
        if col in idxg:
            fila_g[idxg[col]] = val
    desanidar(db.SetTableForEditingArray(GEN, pg[0], campos_g, 1, fila_g))
    desanidar(db.ApplyEditedTables(True, 0, 0, 0, 0, ""))

    # 3b) GRID LINES: una fila por eje con su ordenada (X = letras, Y = numeros).
    pl = desanidar(db.GetTableForEditingArray(LINES, "", 0, [], 0, []))
    campos_l = [str(c) for c in pl[1]]
    idxl = {c: i for i, c in enumerate(campos_l)}

    def fila_linea(linetype, idg, ordenada, bubble):
        f = [""] * len(campos_l)
        f[idxl["Name"]] = GRID
        f[idxl["LineType"]] = linetype
        f[idxl["ID"]] = idg
        f[idxl["Ordinate"]] = str(ordenada)
        f[idxl["BubbleLoc"]] = bubble
        if "Visible" in idxl:
            f[idxl["Visible"]] = "Yes"
        return f

    def fila_general(idg, x1, y1, x2, y2, bubble):
        # EJE INCLINADO: LineType "General (Cartesian)" definido por sus 2 extremos
        # (X1,Y1)-(X2,Y2); Ordinate/Angle quedan vacios (regla 32 de la doc).
        f = [""] * len(campos_l)
        f[idxl["Name"]] = GRID
        f[idxl["LineType"]] = "General (Cartesian)"
        f[idxl["ID"]] = idg
        for col, val in (("X1", x1), ("Y1", y1), ("X2", x2), ("Y2", y2)):
            if col in idxl:
                f[idxl[col]] = str(val)
        f[idxl["BubbleLoc"]] = bubble
        if "Visible" in idxl:
            f[idxl["Visible"]] = "Yes"
        return f

    filas = [fila_linea("X (Cartesian)", idg, o, "End") for idg, o in zip(IDS_X, ORDENADAS_X)]
    filas += [fila_linea("Y (Cartesian)", idg, o, "Start") for idg, o in zip(IDS_Y, ORDENADAS_Y)]
    filas += [fila_general(idg, x1, y1, x2, y2, b) for (idg, x1, y1, x2, y2, b) in EJES_INC]
    datos = [celda for f in filas for celda in f]
    res_set = desanidar(db.SetTableForEditingArray(LINES, pl[0], campos_l, len(filas), datos))
    verificar_retorno(ultimo_int(res_set), "Escribir lineas de grilla")
    res_apply = desanidar(db.ApplyEditedTables(True, 0, 0, 0, 0, ""))
    enteros_apply = [p for p in res_apply if isinstance(p, int) and not isinstance(p, bool)]
    if enteros_apply and enteros_apply[0] != 0:
        raise RuntimeError("ApplyEditedTables reporto %d errores fatales." % enteros_apply[0])

    # 4) ENCUADRAR el plano. Con solo la grilla (sin objetos) RefreshView no ajusta
    #    el zoom; se crean 2 PUNTOS de esquina temporales, se encuadra y se borran
    #    (quedan 0 puntos -> no afectan apoyos ni diagnostico).
    try:
        tope_z = sum(ALTURAS)   # cota Z del techo (suma de las alturas de piso)
        xs_all = list(ORDENADAS_X) + [e[1] for e in EJES_INC] + [e[3] for e in EJES_INC]
        ys_all = list(ORDENADAS_Y) + [e[2] for e in EJES_INC] + [e[4] for e in EJES_INC]
        pa = desanidar(sap_model.PointObj.AddCartesian(float(min(0.0, min(xs_all))), float(min(0.0, min(ys_all))), 0.0))
        pb = desanidar(sap_model.PointObj.AddCartesian(float(max(xs_all)), float(max(ys_all)), tope_z))
        sap_model.View.RefreshView(0, True)
        sap_model.PointObj.DeleteSpecialPoint(str(pa[0]))
        sap_model.PointObj.DeleteSpecialPoint(str(pb[0]))
        sap_model.View.RefreshView(0, False)
    except Exception as e:
        print("Aviso: no se pudo encuadrar la vista:", e)
        sap_model.View.RefreshView(0, True)

    creadas = desanidar(db.GetTableForEditingArray(LINES, "", 0, [], 0, []))[2]
    print("GRILLA NO UNIFORME OK (API pura, sin archivos). Lineas: %d" % creadas)
    print("X:", ORDENADAS_X, "| Y:", ORDENADAS_Y, "| Pisos:", NUMERO_PISOS, "| Ejes inclinados:", len(EJES_INC))`;
}

// ============================================================
// PLANTILLAS EJECUTABLES DESDE LA DOCUMENTACION OFICIAL
// Convierte cualquier metodo de la API en un script listo para
// rellenar y ejecutar — aprendizaje sin IA.
// ============================================================

const PY_PATH_MAP = {
  cSapModel: 'sap_model', cFile: 'sap_model.File', cView: 'sap_model.View',
  cDatabaseTables: 'sap_model.DatabaseTables', cPointObj: 'sap_model.PointObj',
  cFrameObj: 'sap_model.FrameObj', cAreaObj: 'sap_model.AreaObj', cLinkObj: 'sap_model.LinkObj',
  cTendonObj: 'sap_model.TendonObj', cPropMaterial: 'sap_model.PropMaterial',
  cPropFrame: 'sap_model.PropFrame', cPropArea: 'sap_model.PropArea', cPropLink: 'sap_model.PropLink',
  cLoadPatterns: 'sap_model.LoadPatterns', cLoadCases: 'sap_model.LoadCases',
  cCombo: 'sap_model.RespCombo', cAnalyze: 'sap_model.Analyze',
  cAnalysisResults: 'sap_model.Results', cAnalysisResultsSetup: 'sap_model.Results.Setup',
  cGridSys: 'sap_model.GridSys', cStory: 'sap_model.Story', cGroup: 'sap_model.GroupDef',
  cSelect: 'sap_model.SelectObj', cPierLabel: 'sap_model.PierLabel',
  cSpandrelLabel: 'sap_model.SpandrelLabel', cDiaphragm: 'sap_model.Diaphragm',
  cEditFrame: 'sap_model.EditFrame', cEditArea: 'sap_model.EditArea',
  cEditPoint: 'sap_model.EditPoint', cEditGeneral: 'sap_model.EditGeneral',
  cDesignConcrete: 'sap_model.DesignConcrete', cDesignSteel: 'sap_model.DesignSteel',
  cDesignShearWall: 'sap_model.DesignShearWall'
};

function pyPlaceholder(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (t.includes('[]')) return '[]';
  if (t.includes('string')) return '"VALOR"';
  if (t.includes('double')) return '0.0';
  if (t.includes('int')) return '0';
  if (t.includes('bool')) return 'True';
  return 'None';
}

function parseParamsFromSignature(signature) {
  // Plan B: si el servidor no envia los parametros estructurados (proceso
  // viejo sin reiniciar), se extraen de la firma C# textual.
  const sig = String(signature || '');
  const inicio = sig.indexOf('(');
  const fin = sig.lastIndexOf(')');
  if (inicio === -1 || fin <= inicio + 1) return [];
  const interior = sig.slice(inicio + 1, fin);
  const piezas = [];
  let profundidad = 0;
  let actual = '';
  for (const ch of interior) {
    if ('<[('.includes(ch)) profundidad++;
    else if ('>])'.includes(ch)) profundidad--;
    if (ch === ',' && profundidad === 0) {
      piezas.push(actual);
      actual = '';
    } else {
      actual += ch;
    }
  }
  if (actual.trim()) piezas.push(actual);
  return piezas.map(pieza => {
    let tokens = pieza.split('=')[0].replace(/\n/g, ' ').trim().split(/\s+/).filter(Boolean);
    const byref = tokens[0] === 'ref' || tokens[0] === 'out';
    if (byref) tokens = tokens.slice(1);
    if (!tokens.length) return null;
    return {
      name: tokens[tokens.length - 1],
      type: tokens.slice(0, -1).join(' '),
      byref
    };
  }).filter(Boolean);
}

function pyByrefFiller(tipo) {
  // Los parametros ByRef SE PASAN como relleno del tipo correcto
  // (comtypes los exige) y las salidas reales vuelven en la tupla.
  const t = String(tipo || '').toLowerCase();
  if (t.includes('[]')) return '[]';
  if (t.includes('string')) return '""';
  if (t.includes('double')) return '0.0';
  if (t.includes('bool')) return 'False';
  return '0';
}

function buildDocSnippetBody(item) {
  const iface = item.interface || (item.title || '').split('.')[0];
  const member = item.member || (item.title || '').split('.')[1] || '';
  const ruta = PY_PATH_MAP[iface] || `sap_model.${String(iface).replace(/^c/, '')}`;
  const rutaSegura = PY_PATH_MAP[iface] ? '' : '    # OJO: ruta estimada; si falla, busca la interfaz en el Explorador.\n';

  if (item.kind === 'enum') {
    const valores = String(item.enum_members || '').split('; ').slice(0, 12).map(v => `    #   ${v}`).join('\n');
    return `def construir_modelo(sap_model):\n    # === ${item.title} (enumeracion) ===\n    # Usa el valor numerico directamente en la llamada que lo pida:\n${valores}\n    print("Consulta los valores en el comentario y usalos en tu llamada.")`;
  }

  if (item.kind === 'property') {
    return `def construir_modelo(sap_model):\n    # === ${item.title} (propiedad) ===\n${rutaSegura}    objeto = ${ruta}${member ? '.' + member : ''}\n    print(f"Propiedad obtenida: {objeto}")`;
  }

  let params = Array.isArray(item.params) ? item.params : [];
  if (!params.length) {
    // Servidor viejo sin campo params: extraerlos de la firma textual.
    params = parseParamsFromSignature(item.signature);
  }
  const entradas = params.filter(p => !p.byref);
  const salidas = params.filter(p => p.byref);

  const lineasEntrada = entradas.map(p => `    ${p.name} = ${pyPlaceholder(p.type)}  # ${p.type} <- RELLENA este valor`);
  // IMPORTANTE: la llamada lleva TODOS los parametros en su orden original.
  // Los ByRef se pasan como relleno (comtypes los exige) y vuelven en la tupla.
  const argumentos = params.map(p => (p.byref ? pyByrefFiller(p.type) : p.name));
  const llamada = `${ruta}.${member}(${argumentos.join(', ')})`;

  const notaGet = /^Get/i.test(member)
    ? '    # NOTA: los metodos Get* CONSULTAN algo que YA debe existir en el modelo\n    # (crealo antes en este script, o usa el modo "modelo actual" sobre un modelo abierto).\n'
    : '';
  let cuerpo = `def construir_modelo(sap_model):\n    # === ${item.title} ===\n    # Plantilla generada desde la documentacion oficial. Rellena los valores.\n${notaGet}${rutaSegura}`;
  if (lineasEntrada.length) cuerpo += lineasEntrada.join('\n') + '\n\n';

  if (salidas.length) {
    cuerpo += `    # ByRef (${salidas.map(p => p.name).join(', ')}): se pasan como relleno y ETABS los devuelve en la tupla.\n`;
    cuerpo += `    resultado = ${llamada}\n`;
    cuerpo += `    # comtypes devuelve las salidas ANIDADAS en una lista; desanidar:\n`;
    cuerpo += `    partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]\n`;
    cuerpo += `    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):\n`;
    cuerpo += `        partes = list(partes[0])\n`;
    cuerpo += `    print("Salidas (${salidas.map(p => p.name).join(', ')}, ret):", partes)\n`;
    cuerpo += `    enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]\n`;
    cuerpo += `    verificar_retorno(enteros[-1] if enteros else -1, "${member}")`;
  } else {
    cuerpo += `    ret = ${llamada}\n`;
    cuerpo += `    verificar_retorno(ret, "${member}")\n`;
    cuerpo += `    print("${member} ejecutado correctamente.")`;
  }
  return cuerpo;
}

// ============================================================
// HERRAMIENTAS: MATERIALES Y SECCIONES (firmas oficiales ETABS 22)
// Trabajan sobre el modelo ACTUAL (modo feed_current_model):
// no reinicializan ni borran lo ya creado.
// ============================================================

function buildMaterialConcreteBody({ nombre, fc, peso }) {
  return `def construir_modelo(sap_model):
    # === MATERIAL DE CONCRETO en kgf-cm (validado ETABS 22) ===
    NOMBRE = "${nombre}"
    FC_KGCM2 = ${Number(fc).toFixed(1)}        # f'c en kg/cm2
    PESO_KGF_M3 = ${Number(peso).toFixed(1)}   # peso especifico en kgf/m3 (concreto ~2400)

    # El usuario trabaja en kgf-cm: definimos el material EN kgf-cm (unidad 14)
    # para que ETABS guarde y muestre f'c=280, E en kg/cm2, sin conversiones.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    E_KGCM2 = 15000.0 * (FC_KGCM2 ** 0.5)   # E.060 / ACI: Ec = 15000*raiz(f'c[kg/cm2])
    PESO_KGF_CM3 = PESO_KGF_M3 / 1_000_000.0   # 2400 kgf/m3 = 0.0024 kgf/cm3
    print(f"f'c = {FC_KGCM2} kg/cm2 | E = {E_KGCM2:.0f} kg/cm2 | peso = {PESO_KGF_M3} kgf/m3")

    # 1) Material tipo concreto (eMatType: 2 = Concrete).
    ret = sap_model.PropMaterial.SetMaterial(NOMBRE, 2, -1, "", "")
    verificar_retorno(ret, f"Crear material {NOMBRE}")
    # 2) Elasticas: E (kg/cm2), Poisson, dilatacion termica (1/C).
    ret = sap_model.PropMaterial.SetMPIsotropic(NOMBRE, E_KGCM2, 0.2, 0.0000099, 0)
    verificar_retorno(ret, "Propiedades elasticas E y Poisson")
    # 3) Peso especifico (MyOption 1 = peso por volumen, kgf/cm3).
    ret = sap_model.PropMaterial.SetWeightAndMass(NOMBRE, 1, PESO_KGF_CM3, 0)
    verificar_retorno(ret, "Peso especifico")
    # 4) Datos de concreto: f'c en unidades presentes (kg/cm2).
    ret = sap_model.PropMaterial.SetOConcrete_1(NOMBRE, FC_KGCM2, False, 0, 1, 2, 0.0022, 0.0052, -0.1, 0, 0, 0)
    verificar_retorno(ret, "Datos de concreto f'c")

    # Verificacion: releer f'c en kgf-cm debe dar el mismo numero.
    chk = sap_model.PropMaterial.GetOConcrete_1(NOMBRE, 0.0, False, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    partes = list(chk) if isinstance(chk, (list, tuple)) else [chk]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    fc_leido = next((p for p in partes if isinstance(p, float)), None)
    sap_model.SetPresentUnits(8)   # restaurar kgf-m para el resto del flujo
    print(f"MATERIAL {NOMBRE} CREADO Y VERIFICADO: f'c={FC_KGCM2} kg/cm2 (releido {fc_leido:.1f}), E={E_KGCM2:.0f} kg/cm2")`;
}

function buildBeamSectionBody({ nombre, material, baseCm, alturaCm, matRefuerzo, recubCm }) {
  return `def construir_modelo(sap_model):
    # === SECCION DE VIGA en kgf-cm (dimensiones en cm directas) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    MAT_REFUERZO = "${matRefuerzo}"
    BASE_CM = ${Number(baseCm).toFixed(1)}      # b (ancho)
    ALTURA_CM = ${Number(alturaCm).toFixed(1)}  # h (peralte)
    RECUB_CM = ${Number(recubCm).toFixed(1)}    # recubrimiento libre

    # Definir en kgf-cm: dimensiones en CM directamente (sin convertir a m).
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # Firma oficial: SetRectangle(Name, MatProp, T3, T2)
    # T3 = PERALTE (h) y T2 = BASE (b), en unidades presentes (cm).
    T3 = ALTURA_CM
    T2 = BASE_CM
    RECUB = RECUB_CM

    ret = sap_model.PropFrame.SetRectangle(NOMBRE, MATERIAL, T3, T2, -1, "", "")
    verificar_retorno(ret, f"Crear seccion {NOMBRE}")

    # CLAVE: sin esto, ETABS trata la seccion como COLUMNA por defecto.
    # SetRebarBeam la define como VIGA (M3 Design Only) con sus recubrimientos.
    # Areas de refuerzo en 0 = el refuerzo se disena (no se impone).
    ret = sap_model.PropFrame.SetRebarBeam(NOMBRE, MAT_REFUERZO, MAT_REFUERZO, RECUB, RECUB, 0, 0, 0, 0)
    verificar_retorno(ret, f"Definir {NOMBRE} como VIGA (refuerzo M3)")

    # Verificacion post-ejecucion: releer el refuerzo confirma el tipo de diseno.
    chk = sap_model.PropFrame.GetRebarBeam(NOMBRE, "", "", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    partes = list(chk) if isinstance(chk, (list, tuple)) else [chk]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
    verificar_retorno(enteros[-1] if enteros else -1, "Verificar refuerzo de viga")

    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"VIGA {NOMBRE} CREADA Y VERIFICADA: b={BASE_CM} x h={ALTURA_CM} cm, {MATERIAL}, recub {RECUB_CM} cm")`;
}

function buildColumnSectionBody({ nombre, material, baseCm, alturaCm, matRefuerzo, recubCm, barras3, barras2, barraLong, barraEstribo, espEstriboCm }) {
  return `def construir_modelo(sap_model):
    # === SECCION DE COLUMNA (firmas oficiales ETABS 22) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    MAT_REFUERZO = "${matRefuerzo}"
    BASE_CM = ${Number(baseCm).toFixed(1)}        # b (dir 2)
    ALTURA_CM = ${Number(alturaCm).toFixed(1)}    # h (dir 3)
    RECUB_CM = ${Number(recubCm).toFixed(1)}
    BARRAS_DIR3 = ${Number(barras3) || 3}         # barras en cara dir 3
    BARRAS_DIR2 = ${Number(barras2) || 3}         # barras en cara dir 2
    BARRA_LONG = "${barraLong}"                   # diametro barra longitudinal (mm)
    BARRA_ESTRIBO = "${barraEstribo}"             # diametro estribo (mm)
    ESP_ESTRIBO_CM = ${Number(espEstriboCm) || 15}

    # Definir en kgf-cm: dimensiones, recubrimiento y separacion en CM directas.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    T3 = ALTURA_CM
    T2 = BASE_CM
    RECUB = RECUB_CM
    ESP_ESTRIBO = ESP_ESTRIBO_CM

    ret = sap_model.PropFrame.SetRectangle(NOMBRE, MATERIAL, T3, T2, -1, "", "")
    verificar_retorno(ret, f"Crear seccion {NOMBRE}")

    # Definirla como COLUMNA (P-M2-M3) con su refuerzo:
    # SetRebarColumn(Name, MatLong, MatConf, Pattern=1 rectangular,
    #   ConfineType=1 estribos, Cover, NumberCBars=0 (solo circular),
    #   NumberR3Bars, NumberR2Bars, RebarSize, TieSize, TieSpacing,
    #   Number2DirTieBars, Number3DirTieBars, ToBeDesigned=True)
    ret = sap_model.PropFrame.SetRebarColumn(NOMBRE, MAT_REFUERZO, MAT_REFUERZO, 1, 1, RECUB,
                                             0, BARRAS_DIR3, BARRAS_DIR2, BARRA_LONG, BARRA_ESTRIBO,
                                             ESP_ESTRIBO, 3, 3, True)
    verificar_retorno(ret, f"Definir {NOMBRE} como COLUMNA (refuerzo P-M2-M3)")

    # Verificacion post-ejecucion: releer confirma que quedo como columna.
    chk = sap_model.PropFrame.GetRebarColumn(NOMBRE, "", "", 0, 0, 0.0, 0, 0, 0, "", "", 0.0, 0, 0, False)
    partes = list(chk) if isinstance(chk, (list, tuple)) else [chk]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
    verificar_retorno(enteros[-1] if enteros else -1, "Verificar refuerzo de columna")

    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"COLUMNA {NOMBRE} CREADA Y VERIFICADA: {BASE_CM}x{ALTURA_CM} cm, {BARRAS_DIR3}x{BARRAS_DIR2} barras de {BARRA_LONG} mm, estribos {BARRA_ESTRIBO} mm @ {ESP_ESTRIBO_CM} cm")`;
}

// Material de ACERO de refuerzo (validado ETABS 22, sandbox v4): PropMaterial
// tipo Rebar (eMatType 6) + SetORebar_1. Fy/Fu en kg/cm2 -> kN/m2.
function buildSteelMaterialBody({ nombre, fy, fu }) {
  return `def construir_modelo(sap_model):
    # === MATERIAL DE ACERO DE REFUERZO en kgf-cm (validado ETABS 22) ===
    NOMBRE = "${nombre}"
    FY_KGCM2 = ${Number(fy) || 4200}
    FU_KGCM2 = ${Number(fu) || 6300}

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Definir en kgf-cm para que Fy/Fu queden como 4200/6300 (sin conversion).
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # eMatType.Rebar = 6
    ret = sap_model.PropMaterial.SetMaterial(NOMBRE, 6, -1, "", "")
    verificar_retorno(ret, f"Crear material de acero {NOMBRE}")
    # SetORebar_1(Name, Fy, Fu, eFy, eFu, SSType=2, SSHysType=2, StrainHard,
    #   StrainUlt, FinalSlope, UseCaltransSSDefaults=False)
    ret = sap_model.PropMaterial.SetORebar_1(NOMBRE, FY_KGCM2, FU_KGCM2, FY_KGCM2 * 1.17, FU_KGCM2, 2, 2, 0.02, 0.09, -0.1, False)
    verificar_retorno(ret, "Definir curva de acero (SetORebar_1)")

    # Verificacion: releer Fy en kgf-cm.
    chk = desanidar(sap_model.PropMaterial.GetORebar_1(NOMBRE, 0.0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, False))
    verificar_retorno(ret_de(chk), "Verificar acero")
    fy_leido = [x for x in chk if isinstance(x, float)][0]
    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"ACERO {NOMBRE} CREADO Y VERIFICADO: Fy={FY_KGCM2} kg/cm2 (releido {fy_leido:.0f}), Fu={FU_KGCM2} kg/cm2")`;
}

// Dibuja columnas y vigas sobre la grilla EXISTENTE del modelo abierto:
// lee pisos (GetStories_2) y ordenadas de grilla (Database Tables) y crea
// los elementos con AddByCoord. VALIDADO en ETABS 22 (2026-06-12): 204/204.
function buildDrawFramesBody({ seccionColumna, seccionViga, vigasX, vigasY, dibujarColumnas = true, dibujarVigas = true }) {
  return `def construir_modelo(sap_model):
    # === DIBUJAR PORTICOS SOBRE LA GRILLA EXISTENTE (validado ETABS 22) ===
    SECCION_COLUMNA = "${seccionColumna}"
    SECCION_VIGA = "${seccionViga}"
    DIBUJAR_COLUMNAS = ${dibujarColumnas ? 'True' : 'False'}
    DIBUJAR_VIGAS = ${dibujarVigas ? 'True' : 'False'}
    DIBUJAR_VIGAS_X = ${vigasX ? 'True' : 'False'}
    DIBUJAR_VIGAS_Y = ${vigasY ? 'True' : 'False'}

    # Geometria SIEMPRE en kgf-m: las coordenadas y la grilla en metros.
    sap_model.SetPresentUnits(8)   # kgf, m, C

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(resultado):
        enteros = [p for p in resultado if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # 0) Verificar que las secciones que se van a usar existan.
    res = desanidar(sap_model.PropFrame.GetNameList(0, []))
    secciones = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    requeridas = ([SECCION_COLUMNA] if DIBUJAR_COLUMNAS else []) + ([SECCION_VIGA] if DIBUJAR_VIGAS else [])
    for s in requeridas:
        if s not in secciones:
            raise RuntimeError(f"La seccion '{s}' no existe en el modelo. Creala primero. Disponibles: {secciones}")

    # 1) Leer pisos del modelo: [base, n, nombres, elevaciones, alturas, ...]
    res = desanidar(sap_model.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []))
    base = float(res[0])
    elevaciones = sorted(float(x) for x in res[3])
    niveles_z = [base] + elevaciones
    print(f"Niveles Z detectados: {niveles_z}")

    # 2) Leer ordenadas de la grilla del modelo (tabla validada).
    partes = desanidar(sap_model.DatabaseTables.GetTableForEditingArray("Grid Definitions - Grid Lines", "", 0, [], 0, []))
    campos = [str(c) for c in partes[1]]
    datos = [str(d) for d in partes[3]]
    n = len(campos)
    filas = [datos[i * n:(i + 1) * n] for i in range(partes[2])]
    idx_tipo = next(i for i, c in enumerate(campos) if "linetype" in c.lower())
    idx_ord = next(i for i, c in enumerate(campos) if "ordinate" in c.lower())
    ords_x = sorted(float(f[idx_ord]) for f in filas if f[idx_tipo].upper().startswith("X"))
    ords_y = sorted(float(f[idx_ord]) for f in filas if f[idx_tipo].upper().startswith("Y"))
    print(f"Grilla X: {ords_x}")
    print(f"Grilla Y: {ords_y}")

    # 3) Conteo inicial para la verificacion final.
    antes = desanidar(sap_model.FrameObj.GetNameList(0, []))
    n_antes = antes[0] if antes and isinstance(antes[0], int) else 0

    # 4) Columnas: una en cada interseccion, por cada piso.
    columnas = 0
    if DIBUJAR_COLUMNAS:
        for x in ords_x:
            for y in ords_y:
                for i in range(len(niveles_z) - 1):
                    r = desanidar(sap_model.FrameObj.AddByCoord(x, y, niveles_z[i], x, y, niveles_z[i + 1], "", SECCION_COLUMNA, "", "Global"))
                    verificar_retorno(ret_de(r), f"Columna en ({x}, {y}) piso {i + 1}")
                    columnas += 1
        print(f"Columnas creadas: {columnas}")

    # 5) Vigas en cada nivel (sin la base): direccion X y direccion Y.
    vigas = 0
    for z in (niveles_z[1:] if DIBUJAR_VIGAS else []):
        if DIBUJAR_VIGAS_X:
            for y in ords_y:
                for i in range(len(ords_x) - 1):
                    r = desanidar(sap_model.FrameObj.AddByCoord(ords_x[i], y, z, ords_x[i + 1], y, z, "", SECCION_VIGA, "", "Global"))
                    verificar_retorno(ret_de(r), f"Viga X en y={y}, z={z}")
                    vigas += 1
        if DIBUJAR_VIGAS_Y:
            for x in ords_x:
                for i in range(len(ords_y) - 1):
                    r = desanidar(sap_model.FrameObj.AddByCoord(x, ords_y[i], z, x, ords_y[i + 1], z, "", SECCION_VIGA, "", "Global"))
                    verificar_retorno(ret_de(r), f"Viga Y en x={x}, z={z}")
                    vigas += 1
    print(f"Vigas creadas: {vigas}")

    # 6) Verificacion post-ejecucion: el conteo real debe coincidir.
    despues = desanidar(sap_model.FrameObj.GetNameList(0, []))
    n_despues = despues[0] if despues and isinstance(despues[0], int) else 0
    sap_model.View.RefreshView(0, False)
    delta = n_despues - n_antes
    esperado = columnas + vigas
    print(f"VERIFICACION: frames nuevos = {delta}, esperados = {esperado}")
    if delta != esperado:
        raise RuntimeError(f"Conteo no coincide: se crearon {delta} elementos pero se esperaban {esperado}.")
    print(f"PORTICOS DIBUJADOS Y VERIFICADOS: {columnas} columnas ({SECCION_COLUMNA}) + {vigas} vigas ({SECCION_VIGA})")`;
}

// Patrones de carga (flujo E.030 Peru): CM muerta (PP=1), CV viva, CE.
// LoadPatterns.Add(Name, eType, SelfWTMult, AddAnalysisCase=True crea el caso).
// Tipos: Dead=1, SuperDead=2, Live=3, Quake=5, Wind=6, Other=8.
function buildLoadPatternsBody({ incluirCE }) {
  return `def construir_modelo(sap_model):
    # === PATRONES DE CARGA (flujo E.030) ===
    # (nombre, tipo, multiplicador de peso propio)
    patrones = [
        ("CM", 1, 1.0),   # Carga Muerta (Dead) con peso propio
        ("CV", 3, 0.0),   # Carga Viva (Live)
    ]
    ${incluirCE ? 'patrones.append(("CE", 8, 0.0))  # Carga adicional (Other)' : ''}

    # Patrones existentes para no duplicar.
    res = sap_model.LoadPatterns.GetNameList(0, [])
    partes = list(res) if isinstance(res, (list, tuple)) else [res]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    existentes = [str(x) for parte in partes if isinstance(parte, (list, tuple)) for x in parte]

    creados = 0
    for nombre, tipo, mult in patrones:
        if nombre in existentes:
            print(f"Patron {nombre} ya existe, se omite.")
            continue
        ret = sap_model.LoadPatterns.Add(nombre, tipo, mult, True)
        verificar_retorno(ret, f"Crear patron de carga {nombre}")
        creados += 1

    print(f"PATRONES DE CARGA OK: {creados} creados. Cada patron crea su caso estatico lineal.")`;
}

// Combinaciones de diseno E.060 Peru, replicando el flujo del usuario.
// RespCombo.Add(Name, 0=LinearAdd/1=Envelope) + SetCaseList(Name, tipo, caso, factor).
// eCNameType: 0=LoadCase, 1=LoadCombo.
function buildLoadCombosBody({ incluirCE, incluirSismo, casoSismoX, casoSismoY, factorDerivaX, factorDerivaY }) {
  return `def construir_modelo(sap_model):
    # === COMBINACIONES DE DISENO E.060 (flujo del usuario) ===
    INCLUIR_CE = ${incluirCE ? 'True' : 'False'}
    INCLUIR_SISMO = ${incluirSismo ? 'True' : 'False'}
    SX = "${casoSismoX}"   # caso de sismo en X (response spectrum)
    SY = "${casoSismoY}"   # caso de sismo en Y
    # Factor de deriva POR DIRECCION (E.030): 0.75R regular / 0.85R irregular, con
    # R = R0*Ia*Ip de CADA direccion (puede diferir entre X e Y).
    FACTOR_DERIVA_X = ${Number(factorDerivaX) || 4.335}
    FACTOR_DERIVA_Y = ${Number(factorDerivaY) || Number(factorDerivaX) || 4.335}

    combo = sap_model.RespCombo
    LOADCASE = 0   # eCNameType.LoadCase
    LOADCOMBO = 1  # eCNameType.LoadCombo

    def ret_de(resultado):
        # SetCaseList devuelve [CNameType, ret]: el ret es el ultimo entero.
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else (resultado if isinstance(resultado, int) else -1)

    # Combos ya existentes (para re-ejecutar sin error: Add rechaza duplicados).
    res = combo.GetNameList(0, [])
    partes = list(res) if isinstance(res, (list, tuple)) else [res]
    while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
        partes = list(partes[0])
    existentes = [str(x) for parte in partes if isinstance(parte, (list, tuple)) for x in parte]

    def crear_combo(nombre, terminos, tipo=0):
        # tipo: 0 = Linear Add, 1 = Envelope. terminos: [(tipo_item, nombre, factor)]
        if nombre in existentes:
            combo.Delete(nombre)  # borrar para recrear (herramienta re-ejecutable)
        verificar_retorno(ret_de(combo.Add(nombre, tipo)), f"Crear combinacion {nombre}")
        for item_tipo, item_nombre, factor in terminos:
            verificar_retorno(ret_de(combo.SetCaseList(nombre, item_tipo, item_nombre, factor)), f"Agregar {item_nombre} a {nombre}")

    creadas = []

    # --- Combinaciones de gravedad (resistencia ultima E.060) ---
    crear_combo("1.4CM+1.7CV", [(LOADCASE, "CM", 1.4), (LOADCASE, "CV", 1.7)]); creadas.append("1.4CM+1.7CV")
    crear_combo("CM+CV", [(LOADCASE, "CM", 1.0), (LOADCASE, "CV", 1.0)]); creadas.append("CM+CV")
    if INCLUIR_CE:
        crear_combo("1.4CM+1.7CV+1.7CE", [(LOADCASE, "CM", 1.4), (LOADCASE, "CV", 1.7), (LOADCASE, "CE", 1.7)]); creadas.append("1.4CM+1.7CV+1.7CE")
        crear_combo("0.9CM+1.7CE", [(LOADCASE, "CM", 0.9), (LOADCASE, "CE", 1.7)]); creadas.append("0.9CM+1.7CE")

    # --- Combinaciones sismicas (requieren los casos de sismo) ---
    if INCLUIR_SISMO:
        crear_combo("1.25(CM+CV)+CSX", [(LOADCASE, "CM", 1.25), (LOADCASE, "CV", 1.25), (LOADCASE, SX, 1.0)]); creadas.append("1.25(CM+CV)+CSX")
        crear_combo("1.25(CM+CV)+CSY", [(LOADCASE, "CM", 1.25), (LOADCASE, "CV", 1.25), (LOADCASE, SY, 1.0)]); creadas.append("1.25(CM+CV)+CSY")
        crear_combo("0.9CM+CSX", [(LOADCASE, "CM", 0.9), (LOADCASE, SX, 1.0)]); creadas.append("0.9CM+CSX")
        crear_combo("0.9CM+CSY", [(LOADCASE, "CM", 0.9), (LOADCASE, SY, 1.0)]); creadas.append("0.9CM+CSY")

        # Envolvente de diseno (combina las combos de resistencia)
        envolvente = [(LOADCOMBO, "1.4CM+1.7CV", 1.0), (LOADCOMBO, "1.25(CM+CV)+CSX", 1.0),
                      (LOADCOMBO, "1.25(CM+CV)+CSY", 1.0), (LOADCOMBO, "0.9CM+CSX", 1.0),
                      (LOADCOMBO, "0.9CM+CSY", 1.0)]
        if INCLUIR_CE:
            envolvente += [(LOADCOMBO, "1.4CM+1.7CV+1.7CE", 1.0), (LOADCOMBO, "0.9CM+1.7CE", 1.0)]
        crear_combo("EMVOL", envolvente, tipo=1); creadas.append("EMVOL (envolvente)")

        # Combos de deriva (sismo amplificado)
        crear_combo("DERVX", [(LOADCASE, SX, FACTOR_DERIVA_X)]); creadas.append("DERVX")
        crear_combo("DERVY", [(LOADCASE, SY, FACTOR_DERIVA_Y)]); creadas.append("DERVY")

    print(f"COMBINACIONES CREADAS ({len(creadas)}):")
    for c in creadas:
        print(f"   - {c}")`;
}

// ============================================================
// LOSAS Y CARGAS (validado en vivo ETABS 22, sandbox 10/10 OK 2026-06-12)
// eSlabType: 0=Slab, 3=Ribbed, 4=Waffle | eShellType: 1=ShellThin.
// Espesores se ingresan en cm y se convierten a m (unidades del modelo).
// ============================================================

function buildSlabSolidBody({ nombre, material, espesorCm }) {
  return `def construir_modelo(sap_model):
    # === LOSA MACIZA (PropArea.SetSlab, validado ETABS 22) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    ESPESOR_CM = ${espesorCm}

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Definir en kgf-cm: espesor en CM directamente.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # eSlabType: 0=Slab (maciza) | eShellType: 1=ShellThin
    ret = sap_model.PropArea.SetSlab(NOMBRE, 0, 1, MATERIAL, ESPESOR_CM, -1, "", "")
    verificar_retorno(ret, f"Crear losa maciza {NOMBRE}")

    # Verificacion post-ejecucion: releer el espesor (cm).
    r = desanidar(sap_model.PropArea.GetSlab(NOMBRE, 0, 0, "", 0.0, 0, "", ""))
    verificar_retorno(ret_de(r), f"Verificar losa {NOMBRE}")
    espesor = next(p for p in r if isinstance(p, float))
    if abs(espesor - ESPESOR_CM) > 1e-3:
        raise RuntimeError(f"El espesor releido ({espesor} cm) no coincide.")
    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"LOSA MACIZA {NOMBRE} CREADA Y VERIFICADA: h={ESPESOR_CM} cm, material {MATERIAL}")`;
}

function buildSlabRibbedBody({ nombre, material, peralteCm, losaCm, viguetaSupCm, viguetaInfCm, separacionCm, paralelo }) {
  return `def construir_modelo(sap_model):
    # === LOSA ALIGERADA 1D / NERVADA (SetSlab + SetSlabRibbed, validado) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    PERALTE_CM = ${peralteCm}       # peralte total (OverallDepth)
    LOSA_CM = ${losaCm}             # espesor de la losita superior
    VIGUETA_SUP_CM = ${viguetaSupCm}   # ancho de vigueta arriba
    VIGUETA_INF_CM = ${viguetaInfCm}   # ancho de vigueta abajo
    SEPARACION_CM = ${separacionCm}    # separacion entre ejes de viguetas
    PARALELO_A_EJE = ${paralelo}       # viguetas paralelas al eje local 1 o 2

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Definir en kgf-cm: todas las dimensiones en CM directamente.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # 1) Crear la propiedad como tipo Ribbed (eSlabType 3, ShellThin 1).
    ret = sap_model.PropArea.SetSlab(NOMBRE, 3, 1, MATERIAL, PERALTE_CM, -1, "", "")
    verificar_retorno(ret, f"Crear propiedad {NOMBRE}")
    # 2) Datos de nervada: peralte, losita, anchos de vigueta, separacion (cm).
    ret = sap_model.PropArea.SetSlabRibbed(NOMBRE, PERALTE_CM, LOSA_CM,
                                           VIGUETA_SUP_CM, VIGUETA_INF_CM,
                                           SEPARACION_CM, PARALELO_A_EJE)
    verificar_retorno(ret, f"Datos nervada de {NOMBRE}")

    # Verificacion post-ejecucion (cm).
    r = desanidar(sap_model.PropArea.GetSlabRibbed(NOMBRE, 0.0, 0.0, 0.0, 0.0, 0.0, 0))
    verificar_retorno(ret_de(r), f"Verificar {NOMBRE}")
    flot = [p for p in r if isinstance(p, float)]
    if abs(flot[0] - PERALTE_CM) > 1e-3 or abs(flot[4] - SEPARACION_CM) > 1e-3:
        raise RuntimeError(f"Relectura no coincide: {flot}")
    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"LOSA ALIGERADA 1D {NOMBRE} CREADA Y VERIFICADA: h={PERALTE_CM}, losa={LOSA_CM}, vigueta={VIGUETA_SUP_CM}/{VIGUETA_INF_CM} @{SEPARACION_CM} cm")`;
}

function buildSlabWaffleBody({ nombre, material, peralteCm, losaCm, nervioSupCm, nervioInfCm, separacionXCm, separacionYCm }) {
  return `def construir_modelo(sap_model):
    # === LOSA ALIGERADA 2D / WAFFLE (SetSlab + SetSlabWaffle, validado) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    PERALTE_CM = ${peralteCm}
    LOSA_CM = ${losaCm}
    NERVIO_SUP_CM = ${nervioSupCm}
    NERVIO_INF_CM = ${nervioInfCm}
    SEPARACION_X_CM = ${separacionXCm}
    SEPARACION_Y_CM = ${separacionYCm}

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Definir en kgf-cm: dimensiones en CM directamente.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # eSlabType 4 = Waffle, eShellType 1 = ShellThin.
    ret = sap_model.PropArea.SetSlab(NOMBRE, 4, 1, MATERIAL, PERALTE_CM, -1, "", "")
    verificar_retorno(ret, f"Crear propiedad {NOMBRE}")
    ret = sap_model.PropArea.SetSlabWaffle(NOMBRE, PERALTE_CM, LOSA_CM,
                                           NERVIO_SUP_CM, NERVIO_INF_CM,
                                           SEPARACION_X_CM, SEPARACION_Y_CM)
    verificar_retorno(ret, f"Datos waffle de {NOMBRE}")

    r = desanidar(sap_model.PropArea.GetSlabWaffle(NOMBRE, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0))
    verificar_retorno(ret_de(r), f"Verificar {NOMBRE}")
    flot = [p for p in r if isinstance(p, float)]
    if abs(flot[0] - PERALTE_CM) > 1e-3 or abs(flot[4] - SEPARACION_X_CM) > 1e-3:
        raise RuntimeError(f"Relectura no coincide: {flot}")
    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"LOSA ALIGERADA 2D {NOMBRE} CREADA Y VERIFICADA: h={PERALTE_CM}, losa={LOSA_CM}, nervio={NERVIO_SUP_CM}/{NERVIO_INF_CM} @{SEPARACION_X_CM}x{SEPARACION_Y_CM} cm")`;
}

// Dibuja un pano de losa por cada celda de la grilla en cada nivel de piso,
// leyendo pisos (GetStories_2) y grilla (Database Tables) del modelo abierto.
function buildDrawSlabBody({ seccionLosa }) {
  return `def construir_modelo(sap_model):
    # === DIBUJAR LOSA EN CADA PANO DE LA GRILLA (AreaObj.AddByCoord, validado) ===
    SECCION_LOSA = "${seccionLosa}"

    # Geometria en kgf-m (coordenadas en metros).
    sap_model.SetPresentUnits(8)   # kgf, m, C

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # 0) La propiedad de losa debe existir (pasos "Definir losa").
    res = desanidar(sap_model.PropArea.GetNameList(0, []))
    props = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    if SECCION_LOSA not in props:
        raise RuntimeError(f"La losa '{SECCION_LOSA}' no existe. Definela primero. Disponibles: {props}")

    # 1) Pisos y grilla del modelo (igual que el flujo de porticos validado).
    res = desanidar(sap_model.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []))
    elevaciones = sorted(float(x) for x in res[3])
    niveles = elevaciones  # losas en cada nivel de piso (la base no lleva losa)
    partes = desanidar(sap_model.DatabaseTables.GetTableForEditingArray("Grid Definitions - Grid Lines", "", 0, [], 0, []))
    campos = [str(c) for c in partes[1]]
    datos = [str(d) for d in partes[3]]
    n = len(campos)
    filas = [datos[i * n:(i + 1) * n] for i in range(partes[2])]
    idx_tipo = next(i for i, c in enumerate(campos) if "linetype" in c.lower())
    idx_ord = next(i for i, c in enumerate(campos) if "ordinate" in c.lower())
    ords_x = sorted(float(f[idx_ord]) for f in filas if f[idx_tipo].upper().startswith("X"))
    ords_y = sorted(float(f[idx_ord]) for f in filas if f[idx_tipo].upper().startswith("Y"))
    print(f"Grilla X={ords_x} Y={ords_y} Niveles={niveles}")

    # 2) Conteo inicial para la verificacion.
    antes = desanidar(sap_model.AreaObj.GetNameList(0, []))
    n_antes = antes[0] if antes and isinstance(antes[0], int) else 0

    # 3) Un pano por celda de grilla en cada nivel.
    creados = 0
    for z in niveles:
        for i in range(len(ords_x) - 1):
            for j in range(len(ords_y) - 1):
                xs = [ords_x[i], ords_x[i + 1], ords_x[i + 1], ords_x[i]]
                ys = [ords_y[j], ords_y[j], ords_y[j + 1], ords_y[j + 1]]
                zs = [z, z, z, z]
                r = desanidar(sap_model.AreaObj.AddByCoord(4, xs, ys, zs, "", SECCION_LOSA, "", "Global"))
                verificar_retorno(ret_de(r), f"Pano en celda ({i},{j}) z={z}")
                creados += 1

    # 4) Verificacion por conteo.
    despues = desanidar(sap_model.AreaObj.GetNameList(0, []))
    n_despues = despues[0] if despues and isinstance(despues[0], int) else 0
    sap_model.View.RefreshView(0, False)
    if n_despues - n_antes != creados:
        raise RuntimeError(f"Conteo no coincide: delta={n_despues - n_antes} esperados={creados}")
    print(f"LOSA DIBUJADA Y VERIFICADA: {creados} panos con seccion {SECCION_LOSA}")`;
}

// Carga distribuida en VIGAS (frames horizontales): SetLoadDistributed con
// MyType=1 (fuerza), Dir=10 (gravedad) y valores en kgf/m (SetPresentUnits 8:
// la fuerza pasa a kgf y las longitudes SIGUEN en m).
function buildBeamLoadsBody({ cargaCM, cargaCV, filtroSeccion, reemplazar }) {
  return `def construir_modelo(sap_model):
    # === CARGA DISTRIBUIDA EN VIGAS (SetLoadDistributed, validado) ===
    CARGAS = [("CM", ${Number(cargaCM) || 0}), ("CV", ${Number(cargaCV) || 0})]   # (patron, kgf/m); 0 = no asignar
    FILTRO_SECCION = "${filtroSeccion}"     # vacio = todas las vigas
    REEMPLAZAR = ${reemplazar ? 'True' : 'False'}   # True reemplaza la carga previa del patron

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Valores en kgf: cambiar unidades visibles a kgf-m (longitudes siguen en m).
    verificar_retorno(sap_model.SetPresentUnits(8), "Unidades kgf-m")

    res = desanidar(sap_model.FrameObj.GetNameList(0, []))
    nombres = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    if not nombres:
        raise RuntimeError("El modelo no tiene elementos frame. Dibuja los porticos primero.")

    # Detectar vigas: frame horizontal (misma Z en ambos extremos).
    z_punto = {}

    def z_de(punto):
        if punto not in z_punto:
            c = desanidar(sap_model.PointObj.GetCoordCartesian(punto, 0.0, 0.0, 0.0, "Global"))
            z_punto[punto] = [p for p in c if isinstance(p, float)][2]
        return z_punto[punto]

    vigas = []
    for nombre in nombres:
        if FILTRO_SECCION:
            rs = desanidar(sap_model.FrameObj.GetSection(nombre, "", ""))
            seccion = next((s for s in rs if isinstance(s, str)), "")
            if seccion != FILTRO_SECCION:
                continue
        rp = desanidar(sap_model.FrameObj.GetPoints(nombre, "", ""))
        puntos = [s for s in rp if isinstance(s, str)]
        if len(puntos) >= 2 and abs(z_de(puntos[0]) - z_de(puntos[1])) < 0.01:
            vigas.append(nombre)
    if not vigas:
        raise RuntimeError("No se encontraron vigas" + (f" con seccion {FILTRO_SECCION}" if FILTRO_SECCION else "") + ".")
    print(f"Vigas detectadas: {len(vigas)}")

    # Asignar: MyType=1 fuerza, Dir=10 gravedad, distancias relativas 0 a 1.
    asignadas = 0
    for patron, valor in CARGAS:
        if not valor:
            continue
        for v in vigas:
            ret = sap_model.FrameObj.SetLoadDistributed(v, patron, 1, 10, 0.0, 1.0, valor, valor, "Global", True, REEMPLAZAR, 0)
            verificar_retorno(ret, f"Carga {patron}={valor} en viga {v}")
            asignadas += 1

    # Verificacion post-ejecucion: releer la primera viga.
    r = desanidar(sap_model.FrameObj.GetLoadDistributed(vigas[0], 0, [], [], [], [], [], [], [], [], [], [], []))
    verificar_retorno(ret_de(r), f"Verificar cargas de la viga {vigas[0]}")
    n_items = next(p for p in r if isinstance(p, int) and not isinstance(p, bool))
    print(f"CARGAS EN VIGAS OK: {asignadas} asignaciones en {len(vigas)} vigas (la viga {vigas[0]} tiene {n_items} cargas)")`;
}

// Carga uniforme en LOSAS: SetLoadUniform con Dir=10 (gravedad), kgf/m2.
function buildSlabLoadsBody({ cargaCM, cargaCV, filtroPropiedad, reemplazar }) {
  return `def construir_modelo(sap_model):
    # === CARGA UNIFORME EN LOSAS (AreaObj.SetLoadUniform, validado) ===
    CARGAS = [("CM", ${Number(cargaCM) || 0}), ("CV", ${Number(cargaCV) || 0})]  # (patron, kgf/m2); 0 = no asignar
    FILTRO_PROPIEDAD = "${filtroPropiedad}"   # ej. una losa especifica; vacio = todas
    REEMPLAZAR = ${reemplazar ? 'True' : 'False'}

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    verificar_retorno(sap_model.SetPresentUnits(8), "Unidades kgf-m")

    res = desanidar(sap_model.AreaObj.GetNameList(0, []))
    areas = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    if not areas:
        raise RuntimeError("El modelo no tiene losas dibujadas. Dibuja la losa primero.")

    objetivo = []
    for a in areas:
        if FILTRO_PROPIEDAD:
            rp = desanidar(sap_model.AreaObj.GetProperty(a, ""))
            prop = next((s for s in rp if isinstance(s, str)), "")
            if prop != FILTRO_PROPIEDAD:
                continue
        objetivo.append(a)
    if not objetivo:
        raise RuntimeError("No hay losas" + (f" con propiedad {FILTRO_PROPIEDAD}" if FILTRO_PROPIEDAD else "") + ".")
    print(f"Losas a cargar: {len(objetivo)}")

    asignadas = 0
    for patron, valor in CARGAS:
        if not valor:
            continue
        for a in objetivo:
            ret = sap_model.AreaObj.SetLoadUniform(a, patron, valor, 10, REEMPLAZAR, "Global", 0)
            verificar_retorno(ret, f"Carga {patron}={valor} en losa {a}")
            asignadas += 1

    r = desanidar(sap_model.AreaObj.GetLoadUniform(objetivo[0], 0, [], [], [], [], []))
    verificar_retorno(ret_de(r), f"Verificar cargas de la losa {objetivo[0]}")
    n_items = next(p for p in r if isinstance(p, int) and not isinstance(p, bool))
    print(f"CARGAS EN LOSA OK: {asignadas} asignaciones en {len(objetivo)} losas (la losa {objetivo[0]} tiene {n_items} cargas)")`;
}

// MUROS (validado ETABS 22, sandbox v4). Definir: PropArea.SetWall
// (eWallPropType.Specified=1, eShellType.ShellThin=1).
function buildWallDefBody({ nombre, material, espesorCm }) {
  return `def construir_modelo(sap_model):
    # === DEFINIR MURO (PropArea.SetWall, validado ETABS 22) ===
    NOMBRE = "${nombre}"
    MATERIAL = "${material}"
    ESPESOR_CM = ${Number(espesorCm) || 30}

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Definir en kgf-cm: espesor en CM directamente.
    sap_model.SetPresentUnits(14)   # kgf, cm, C
    # eWallPropType.Specified = 1, eShellType.ShellThin = 1
    ret = sap_model.PropArea.SetWall(NOMBRE, 1, 1, MATERIAL, ESPESOR_CM, -1, "", "")
    verificar_retorno(ret, f"Crear muro {NOMBRE}")
    r = desanidar(sap_model.PropArea.GetWall(NOMBRE, 1, 1, "", 0.0, 0, "", ""))
    verificar_retorno(ret_de(r), f"Verificar muro {NOMBRE}")
    esp = [x for x in r if isinstance(x, float)][0]
    if abs(esp - ESPESOR_CM) > 1e-3:
        raise RuntimeError(f"Espesor releido ({esp} cm) no coincide.")
    sap_model.SetPresentUnits(8)   # restaurar kgf-m
    print(f"MURO {NOMBRE} CREADO Y VERIFICADO: e={ESPESOR_CM} cm, material {MATERIAL}")`;
}

// Dibujar muros como paneles verticales entre la base y cada nivel, a lo
// largo de los ejes de grilla PERIMETRALES (validado ETABS 22).
function buildWallDrawBody({ propiedad, soloPerimetro, soloPrimerNivel }) {
  return `def construir_modelo(sap_model):
    # === DIBUJAR MUROS (paneles verticales sobre ejes de grilla) ===
    PROPIEDAD = "${propiedad}"
    SOLO_PERIMETRO = ${soloPerimetro ? 'True' : 'False'}   # solo ejes del borde
    SOLO_PRIMER_NIVEL = ${soloPrimerNivel ? 'True' : 'False'}  # tipico sotano: solo base->1er nivel

    # Geometria en kgf-m (coordenadas en metros).
    sap_model.SetPresentUnits(8)   # kgf, m, C

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # 0) La propiedad de muro debe existir.
    props = [str(x) for parte in desanidar(sap_model.PropArea.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    if PROPIEDAD not in props:
        raise RuntimeError(f"El muro '{PROPIEDAD}' no existe. Definelo primero. Disponibles: {props}")

    # 1) Pisos y grilla del modelo.
    res = desanidar(sap_model.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []))
    base = float(res[0])
    elevaciones = sorted(float(x) for x in res[3])
    niveles = [base] + elevaciones
    if SOLO_PRIMER_NIVEL:
        niveles = niveles[:2]   # base y primer nivel
    partes = desanidar(sap_model.DatabaseTables.GetTableForEditingArray("Grid Definitions - Grid Lines", "", 0, [], 0, []))
    campos = [str(c) for c in partes[1]]
    datos = [str(d) for d in partes[3]]
    nc = len(campos)
    filas = [datos[i * nc:(i + 1) * nc] for i in range(partes[2])]
    it = next(i for i, c in enumerate(campos) if "linetype" in c.lower())
    io = next(i for i, c in enumerate(campos) if "ordinate" in c.lower())
    ords_x = sorted(float(f[io]) for f in filas if f[it].upper().startswith("X"))
    ords_y = sorted(float(f[io]) for f in filas if f[it].upper().startswith("Y"))
    x_min, x_max = ords_x[0], ords_x[-1]
    y_min, y_max = ords_y[0], ords_y[-1]
    print(f"Grilla X={ords_x} Y={ords_y} niveles={niveles}")

    antes = desanidar(sap_model.AreaObj.GetNameList(0, []))
    n0 = antes[0] if antes and isinstance(antes[0], int) else 0

    def panel(xa, ya, xb, yb, z0, z1):
        xs = [xa, xb, xb, xa]; ys = [ya, yb, yb, ya]; zs = [z0, z0, z1, z1]
        r = desanidar(sap_model.AreaObj.AddByCoord(4, xs, ys, zs, "", PROPIEDAD, "", "Global"))
        verificar_retorno(ret_de(r), f"Panel de muro ({xa},{ya})-({xb},{yb})")

    creados = 0
    for k in range(len(niveles) - 1):
        z0, z1 = niveles[k], niveles[k + 1]
        # Muros en lineas Y (corren en X): por cada linea Y, entre ejes X consecutivos
        for y in ords_y:
            if SOLO_PERIMETRO and y not in (y_min, y_max):
                continue
            for i in range(len(ords_x) - 1):
                panel(ords_x[i], y, ords_x[i + 1], y, z0, z1); creados += 1
        # Muros en lineas X (corren en Y)
        for x in ords_x:
            if SOLO_PERIMETRO and x not in (x_min, x_max):
                continue
            for j in range(len(ords_y) - 1):
                panel(x, ords_y[j], x, ords_y[j + 1], z0, z1); creados += 1

    despues = desanidar(sap_model.AreaObj.GetNameList(0, []))
    n1 = despues[0] if despues and isinstance(despues[0], int) else 0
    sap_model.View.RefreshView(0, False)
    if n1 - n0 != creados:
        raise RuntimeError(f"Conteo no coincide: delta={n1 - n0} esperados={creados}")
    print(f"MUROS DIBUJADOS Y VERIFICADOS: {creados} paneles de {PROPIEDAD}")`;
}

// Cargar muros con empuje de tierra (CE) como presion UNIFORME equivalente
// (presion media Ka*gamma*H/2, direccion local 3 perpendicular al muro).
// VALIDADO ETABS 22 (sandbox v4): SetLoadUniform Dir=3 local. El empuje
// triangular exacto via tablas no es fiable (campo Dir rechaza el string).
function buildWallLoadBody({ propiedad, patron, gammaSuelo, ka, alturaM, presionDirecta }) {
  return `def construir_modelo(sap_model):
    # === CARGAR MURO: empuje de tierra equivalente (validado ETABS 22) ===
    PROPIEDAD = "${propiedad}"   # solo muros con esta propiedad (vacio = todos)
    PATRON = "${patron}"
    PRESION_DIRECTA = ${Number(presionDirecta) || 0}   # kgf/m2; si >0 se usa tal cual
    GAMMA = ${Number(gammaSuelo) || 1800}   # peso especifico del suelo (kgf/m3)
    KA = ${Number(ka) || 0.33}              # coef. de empuje activo
    ALTURA = ${Number(alturaM) || 0}        # altura de empuje (m); 0 = autodetecta del muro

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    verificar_retorno(sap_model.SetPresentUnits(8), "Unidades kgf-m")

    # Patron CE debe existir.
    patrones = [str(x) for parte in desanidar(sap_model.LoadPatterns.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    if PATRON not in patrones:
        raise RuntimeError(f"El patron '{PATRON}' no existe. Define los patrones primero.")

    # Identificar los muros: areas cuya propiedad coincide.
    areas = [str(x) for parte in desanidar(sap_model.AreaObj.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    muros = []
    altura_auto = 0.0
    for a in areas:
        prop = next((s for s in desanidar(sap_model.AreaObj.GetProperty(a, "")) if isinstance(s, str)), "")
        if PROPIEDAD and prop != PROPIEDAD:
            continue
        muros.append(a)
        # altura del panel = diferencia de z de sus puntos (autodeteccion robusta)
        try:
            pts = [str(x) for parte in desanidar(sap_model.AreaObj.GetPoints(a, 0, [])) if isinstance(parte, (list, tuple)) for x in parte]
            zs = []
            for p in pts:
                c = desanidar(sap_model.PointObj.GetCoordCartesian(p, 0.0, 0.0, 0.0, "Global"))
                zs.append([x for x in c if isinstance(x, float)][2])
            if zs:
                altura_auto = max(altura_auto, max(zs) - min(zs))
        except Exception:
            pass
    if not muros:
        raise RuntimeError(f"No hay muros con propiedad '{PROPIEDAD}'. Dibuja el muro primero.")

    H = ALTURA if ALTURA > 0 else (altura_auto if altura_auto > 0 else 3.0)
    if PRESION_DIRECTA > 0:
        presion = PRESION_DIRECTA
    else:
        # Empuje triangular 0..Ka*gamma*H -> presion media uniforme equivalente.
        presion = KA * GAMMA * H / 2.0
    print(f"Empuje: H={H:.2f} m, presion media = {presion:.1f} kgf/m2 (Ka={KA}, gamma={GAMMA})")

    # Dir=3 (local 3, perpendicular al muro = empuje lateral), CSys local.
    n = 0
    for a in muros:
        verificar_retorno(sap_model.AreaObj.SetLoadUniform(a, PATRON, presion, 3, True, "Local", 0), f"Empuje en muro {a}")
        n += 1

    r = desanidar(sap_model.AreaObj.GetLoadUniform(muros[0], 0, [], [], [], [], []))
    verificar_retorno(ret_de(r), "Verificar empuje")
    print(f"EMPUJE APLICADO Y VERIFICADO: {presion:.1f} kgf/m2 en {n} muros ({PROPIEDAD}), patron {PATRON}")`;
}

// Espectro E.030 parametrico + Modal Ritz + masa sismica + casos CSX/CSY.
// HALLAZGO VALIDADO: la API de ETABS 22 NO tiene FuncRS.SetUser ni
// SetDampConstant; la funcion de usuario se crea via Database Tables
// ("Functions - Response Spectrum - User Defined": Name, Period, Value,
// DampRatio, GUID) y el amortiguamiento constante por defecto ya es 0.05.
// MASS SOURCE: fuente de masa sismica E.030 (validado: PropMaterial.SetMassSource_1,
// firma oficial: IncludeElements, IncludeAddedMass, IncludeLoads, N, LoadPat[], SF[]).
// La masa sale de los patrones de carga (CM x factor + %CV) y, opcional, del peso propio
// de los elementos. Es la MISMA llamada que hace el paso Espectro (idempotente): definirla
// aqui antes deja la fuente de masa lista para el modal/espectral.
function buildMassSourceBody({ masaCM, masaCV, incluirElementos, patronCM, patronCV }) {
  return `def construir_modelo(sap_model):
    # === MASS SOURCE: fuente de masa sismica (validado ETABS 22) ===
    INCLUIR_ELEMENTOS = ${incluirElementos ? 'True' : 'False'}   # peso propio de elementos
    MASA = [("${patronCM}", ${masaCM}), ("${patronCV}", ${masaCV})]   # (patron, factor)

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Los patrones de la masa deben existir (se crean en "Definir patrones de carga").
    patrones = [str(x) for parte in desanidar(sap_model.LoadPatterns.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    for patron, _ in MASA:
        if patron not in patrones:
            raise RuntimeError(f"El patron '{patron}' no existe. Define los patrones de carga primero.")

    # Definir la fuente de masa: cargas CM/CV con sus factores (+ peso propio opcional).
    nombres = [p for p, _ in MASA]
    factores = [float(f) for _, f in MASA]
    r = desanidar(sap_model.PropMaterial.SetMassSource_1(INCLUIR_ELEMENTOS, False, True, len(MASA), nombres, factores))
    verificar_retorno(ret_de(r), "Definir mass source (SetMassSource_1)")
    print(f"OK mass source: {'peso propio + ' if INCLUIR_ELEMENTOS else ''}cargas {list(zip(nombres, factores))}")
`;
}

// AUTOMESH LOSAS Y MUROS: replica los diálogos "Floor/Wall Auto Mesh Options" de ETABS.
// HALLAZGO (validado en vivo ETABS 22, 2026-06-20): la API de cAreaObj NO tiene SetAutoMesh
// (se confirmó: 71 métodos, ninguno 'mesh' salvo SetEdgeConstraint). PERO las opciones de
// auto-mallado SÍ se asignan por DATABASE TABLES (igual que grillas/espectro):
//   - LOSAS: tabla "Area Assignments - Floor Auto Mesh Options". MeshOption="Auto Cookie Cut"
//     (= "Auto Cookie Cut Object into Structural Elements" del diálogo) + AtBeams/AtWalls/AtGrids
//     + Submesh/SubmeshSize (tamaño máx. elemento) + Restraints.
//   - MUROS: tabla "Area Assignments - Wall Auto Mesh Options". MeshOption="Auto Rectangular Mesh".
//     El tamaño máx. es GLOBAL: tabla "Analysis Options - Automatic Rectangular Mesh Options for
//     Walls" (campo MaxMeshSize) — aplica a todos los muros con malla rectangular.
// Como en el GUI, PRIMERO se SELECCIONAN los elementos (SelectObj.ClearSelection + SetSelected),
// luego se asignan por tabla. Strings de MeshOption y campos verificados leyendo de vuelta.
function buildAutomeshBody({ soloTipo, maxSize, atGrids }) {
  const ms = (Number(maxSize) > 0 ? Number(maxSize) : 0.7).toString();
  return `def construir_modelo(sap_model):
    # === AUTOMESH LOSAS Y MUROS: auto-mallado por tablas (validado ETABS 22) ===
    SOLO_TIPO = "${soloTipo || 'todas'}"   # todas | losas | muros
    MAX_SIZE = "${ms}"                      # tamano max. de elemento (m)
    AT_GRIDS = "${atGrids ? 'Yes' : 'No'}"  # mallar losas tambien en grillas visibles

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ints_de(partes):
        return [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]

    def aplicar(db, tag):
        ap = ints_de(desanidar(db.ApplyEditedTables(True, 0, 0, 0, 0, "")))
        if ap and ap[0] != 0:
            raise RuntimeError("%s: ApplyEditedTables reporto %d errores fatales." % (tag, ap[0]))

    db = sap_model.DatabaseTables
    areas = [str(x) for parte in desanidar(sap_model.AreaObj.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    if not areas:
        raise RuntimeError("No hay areas (losas/muros) en el modelo. Dibuja losas o muros primero.")

    def orientacion(a):
        # eAreaDesignOrientation (VALIDADO ETABS 22): 1 = Wall (muro), 2 = Floor (losa).
        o = ints_de(desanidar(sap_model.AreaObj.GetDesignOrientation(a, 0)))
        return o[0] if o else 0

    losas = [a for a in areas if orientacion(a) == 2]
    muros = [a for a in areas if orientacion(a) == 1]
    if SOLO_TIPO == "losas":
        muros = []
    if SOLO_TIPO == "muros":
        losas = []
    if not losas and not muros:
        raise RuntimeError("No se encontraron areas del tipo '%s'." % SOLO_TIPO)

    # 1) SELECCIONAR los elementos objetivo (como en el GUI: primero se seleccionan).
    try:
        sap_model.SelectObj.ClearSelection()
    except Exception:
        pass
    for a in losas + muros:
        sap_model.AreaObj.SetSelected(a, True)

    # 2) LOSAS -> "Auto Cookie Cut Object into Structural Elements" + tamano max. por objeto.
    if losas:
        FLOOR = "Area Assignments - Floor Auto Mesh Options"
        pf = desanidar(db.GetTableForEditingArray(FLOOR, "", 0, [], 0, []))
        vf = pf[0]; cf = [str(c) for c in pf[1]]; jf = {c: i for i, c in enumerate(cf)}
        filas = []
        for a in losas:
            f = [""] * len(cf)
            f[jf["UniqueName"]] = a
            f[jf["MeshOption"]] = "Auto Cookie Cut"
            for col, val in (("AtBeams", "Yes"), ("AtWalls", "Yes"), ("AtGrids", AT_GRIDS),
                             ("Submesh", "Yes"), ("SubmeshSize", MAX_SIZE), ("Restraints", "No")):
                if col in jf:
                    f[jf[col]] = val
            filas.append(f)
        desanidar(db.SetTableForEditingArray(FLOOR, vf, cf, len(filas), [c for f in filas for c in f]))
        aplicar(db, "Floor auto mesh")

    # 3) MUROS -> "Auto Rectangular Mesh" (por objeto) + tamano max. GLOBAL de malla rectangular.
    if muros:
        WALL = "Area Assignments - Wall Auto Mesh Options"
        pw = desanidar(db.GetTableForEditingArray(WALL, "", 0, [], 0, []))
        vw = pw[0]; cw = [str(c) for c in pw[1]]; jw = {c: i for i, c in enumerate(cw)}
        filas = []
        for a in muros:
            f = [""] * len(cw)
            f[jw["UniqueName"]] = a
            f[jw["MeshOption"]] = "Auto Rectangular Mesh"
            if "Restraints" in jw:
                f[jw["Restraints"]] = "Yes"
            filas.append(f)
        desanidar(db.SetTableForEditingArray(WALL, vw, cw, len(filas), [c for f in filas for c in f]))
        aplicar(db, "Wall auto mesh")
        GW = "Analysis Options - Automatic Rectangular Mesh Options for Walls"
        pg = desanidar(db.GetTableForEditingArray(GW, "", 0, [], 0, []))
        vg = pg[0]; cg = [str(c) for c in pg[1]]; jg = {c: i for i, c in enumerate(cg)}
        fg = [""] * len(cg)
        if "MaxMeshSize" in jg:
            fg[jg["MaxMeshSize"]] = MAX_SIZE
        desanidar(db.SetTableForEditingArray(GW, vg, cg, 1, fg))
        aplicar(db, "Tamano global de malla de muros")

    print("AUTOMESH OK: %d losa(s) (cookie cut, max %s m), %d muro(s) (rectangular, max %s m)."
          % (len(losas), MAX_SIZE, len(muros), MAX_SIZE))
`;
}

// Helpers Python compartidos por el diafragma (definir/asignar y diagnostico).
// VALIDADO en vivo ETABS 22 (2026-06-20): Story.GetNameList/GetElevation,
// PointObj.GetNameListOnStory, GetRestraint, GetDiaphragm; asignacion por punto con
// eDiaphragmOption.DefinedDiaphragm=3; diagnostico por piso (Story2 -> FALTA).
const DIAFRAGMA_HELPERS = `
    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ints_de(partes):
        return [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]

    def ret_de(partes):
        e = ints_de(partes)
        return e[-1] if e else -1

    def todos_de(resultado, tipo):
        out = []
        def rec(x):
            if isinstance(x, tipo) and not (tipo is int and isinstance(x, bool)):
                out.append(x)
            elif isinstance(x, (list, tuple)):
                for v in x:
                    rec(v)
        rec(resultado)
        return out

    def pisos_nombrados(sap_model):
        # Pisos definidos (NO incluye la Base) ordenados de abajo hacia arriba.
        nombres = todos_de(sap_model.Story.GetNameList(), str)
        def elev(s):
            e = todos_de(sap_model.Story.GetElevation(s, 0.0), float)
            return e[0] if e else 0.0
        return sorted(set(nombres), key=elev), elev

    def restringido(sap_model, p):
        # Un apoyo (base) tiene alguna restriccion -> NO recibe diafragma.
        return any(todos_de(sap_model.PointObj.GetRestraint(p, [False] * 6), bool))

    def nudos_de_piso(sap_model, s):
        # Nudos del piso SIN los apoyos (la base nunca lleva diafragma).
        return [p for p in todos_de(sap_model.PointObj.GetNameListOnStory(s, 0, []), str)
                if not restringido(sap_model, p)]

    def es_rigido(sap_model, nombre):
        sr = todos_de(sap_model.Diaphragm.GetDiaphragm(nombre, False), bool)
        return (not sr[0]) if sr else False
`;

// ASIGNAR DIAFRAGMA: define un diafragma (cDiaphragm.SetDiaphragm; SemiRigid=False -> rigido) y
// lo asigna POR PUNTO (cPointObj.SetDiaphragm, eDiaphragmOption.DefinedDiaphragm=3) a TODOS los
// nudos de los PISOS elegidos (todos o una lista), EXCLUYENDO los apoyos (la base NUNCA lleva
// diafragma). Como en el GUI (Assign > Joint > Diaphragms) primero SELECCIONA los nudos. Reporta
// por piso. ETABS agrupa por nivel -> un diafragma rigido independiente por piso.
function buildDiaphragmBody({ nombre, semiRigido, alcance, pisos }) {
  const nom = (nombre || 'D1-rigido').replace(/"/g, '');
  const pyPisos = '[' + String(pisos || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => `"${s.replace(/"/g, '')}"`).join(', ') + ']';
  return `def construir_modelo(sap_model):
    # === DIAFRAGMA ${semiRigido ? 'SEMI-RIGIDO' : 'RIGIDO'}: definir + asignar por punto a los pisos ===
    NOMBRE = "${nom}"
    SEMI_RIGIDO = ${semiRigido ? 'True' : 'False'}
    ALCANCE = "${alcance === 'especificos' ? 'especificos' : 'todos'}"   # todos | especificos
    PISOS_PEDIDOS = ${pyPisos}   # solo si ALCANCE == especificos
${DIAFRAGMA_HELPERS}
    # 1) DEFINIR el diafragma SOLO si no existe. OJO (validado ETABS 22): cDiaphragm.SetDiaphragm
    #    devuelve 1 (ERROR) si el nombre YA existe — NO actualiza. Por eso se crea solo si falta;
    #    si existe con otra rigidez, se borra (Diaphragm.Delete) y se recrea. Hace el paso re-ejecutable.
    existentes = todos_de(sap_model.Diaphragm.GetNameList(), str)
    if NOMBRE in existentes:
        sr = todos_de(sap_model.Diaphragm.GetDiaphragm(NOMBRE, False), bool)
        actual_semi = sr[0] if sr else False
        if actual_semi != SEMI_RIGIDO:
            sap_model.Diaphragm.Delete(NOMBRE)
            verificar_retorno(ret_de(desanidar(sap_model.Diaphragm.SetDiaphragm(NOMBRE, SEMI_RIGIDO))),
                              "Recrear diafragma " + NOMBRE)
            print("Diafragma %s recreado con la rigidez pedida (%s)." % (NOMBRE, "semi-rigido" if SEMI_RIGIDO else "rigido"))
        else:
            print("Diafragma %s ya existe con la rigidez pedida (se reutiliza)." % NOMBRE)
    else:
        verificar_retorno(ret_de(desanidar(sap_model.Diaphragm.SetDiaphragm(NOMBRE, SEMI_RIGIDO))),
                          "Definir diafragma " + NOMBRE)

    # 2) PISOS objetivo (la base no es un piso nombrado -> nunca entra).
    todos_pisos, _elev = pisos_nombrados(sap_model)
    if not todos_pisos:
        raise RuntimeError("No hay pisos definidos. Crea la grilla/pisos primero.")
    if ALCANCE == "especificos":
        pedidos = [s.strip() for s in PISOS_PEDIDOS]
        objetivo_pisos = [s for s in todos_pisos if s in pedidos]
        faltan = [s for s in pedidos if s not in todos_pisos]
        if faltan:
            print("AVISO: estos pisos no existen y se ignoran:", faltan)
        if not objetivo_pisos:
            raise RuntimeError("Ninguno de los pisos pedidos existe. Pisos del modelo: %s" % todos_pisos)
    else:
        objetivo_pisos = list(todos_pisos)

    # 3) SELECCIONAR + ASIGNAR por punto, piso por piso (eDiaphragmOption.DefinedDiaphragm = 3).
    try:
        sap_model.SelectObj.ClearSelection()
    except Exception:
        pass
    total = 0
    resumen = []
    for s in objetivo_pisos:
        nudos = nudos_de_piso(sap_model, s)
        n = 0
        for p in nudos:
            try:
                sap_model.PointObj.SetSelected(p, True)
            except Exception:
                pass
            if ret_de(desanidar(sap_model.PointObj.SetDiaphragm(p, 3, NOMBRE))) == 0:
                n += 1
        total += n
        resumen.append((s, n, len(nudos)))
    sap_model.View.RefreshView(0, False)
    print("DIAFRAGMA %s (%s) asignado: %d nudos en %d piso(s)."
          % (NOMBRE, "semi-rigido" if SEMI_RIGIDO else "rigido", total, len(objetivo_pisos)))
    for s, n, t in resumen:
        print("   %s: %d/%d nudos" % (s, n, t))
`;
}

// DIAGNOSTICO (solo lectura): por cada piso (sin la base), cuenta cuantos nudos tienen un
// diafragma RIGIDO asignado y avisa de los pisos SIN diafragma rigido completo.
function buildDiaphragmCheckBody() {
  return `def construir_modelo(sap_model):
    # === DIAGNOSTICO DE DIAFRAGMAS POR PISO (no modifica el modelo) ===
${DIAFRAGMA_HELPERS}
    todos_pisos, _elev = pisos_nombrados(sap_model)
    if not todos_pisos:
        raise RuntimeError("No hay pisos definidos en el modelo.")
    print("=== DIAFRAGMAS POR PISO (la base no lleva diafragma) ===")
    sin = []
    parcial = []
    for s in todos_pisos:
        nudos = nudos_de_piso(sap_model, s)
        if not nudos:
            print("   %s: sin nudos de planta (se omite)" % s)
            continue
        con = 0
        nombres_d = set()
        for p in nudos:
            g = desanidar(sap_model.PointObj.GetDiaphragm(p, 0, ""))
            opt = ints_de(g)
            nm = todos_de(g, str)
            if opt and opt[0] == 3 and nm and es_rigido(sap_model, nm[0]):
                con += 1
                nombres_d.add(nm[0])
        if con == 0:
            estado = "SIN DIAFRAGMA RIGIDO"; sin.append(s)
        elif con < len(nudos):
            estado = "PARCIAL"; parcial.append(s)
        else:
            estado = "OK"
        print("   %s: %d/%d nudos rigidos %s -> %s" % (s, con, len(nudos), sorted(nombres_d), estado))
    print("-" * 40)
    if not sin and not parcial:
        print("RESULTADO: todos los pisos tienen diafragma rigido. OK.")
    else:
        if sin:
            print("PISOS SIN DIAFRAGMA RIGIDO:", sin)
        if parcial:
            print("PISOS CON DIAFRAGMA PARCIAL (revisar):", parcial)
`;
}

// END LENGTH OFFSET (brazos rigidos): replica "Frame Assignment - End Length Offsets".
// HALLAZGO validado en vivo (ETABS 22, 2026-06-20): cFrameObj.SetEndLengthOffset con
// AutoOffset=True NO guarda el factor de zona rigida (RigidFact queda 0); SI lo guarda con
// AutoOffset=False. Para "Automatic from Connectivity" + factor 0.5 (lo del dialogo) se usa la
// Database Table "Frame Assignments - End Length Offsets" (OffsetOpt="Auto", RigidFact=0.5);
// para "Definir longitudes" basta la API (auto=False persiste el factor). Clasifica con
// FrameObj.GetDesignOrientation (1=Columna, 2=Viga, 3=Brace). Como en el GUI, primero SELECCIONA.
function buildEndOffsetBody({ tipo, auto, rzFactor, lenI, lenJ }) {
  const rz = Number.isFinite(Number(rzFactor)) ? Number(rzFactor) : 0.5;
  const li = Number(lenI) || 0;
  const lj = Number(lenJ) || 0;
  return `def construir_modelo(sap_model):
    # === END LENGTH OFFSET (brazos rigidos) en vigas y columnas ===
    TIPO = "${tipo || 'todas'}"   # todas | vigas | columnas
    AUTO = ${auto ? 'True' : 'False'}   # True = Automatic from Connectivity
    RZ = ${rz}                          # factor de zona rigida (0..1)
    LEN_I = ${li}                       # End-I (m), solo si AUTO = False
    LEN_J = ${lj}                       # End-J (m), solo si AUTO = False

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ints_de(partes):
        return [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]

    def ret_de(partes):
        e = ints_de(partes)
        return e[-1] if e else -1

    frames = [str(x) for parte in desanidar(sap_model.FrameObj.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
    if not frames:
        raise RuntimeError("No hay frames (vigas/columnas) en el modelo. Dibuja primero.")

    def orient(f):
        # eFrameDesignOrientation (VALIDADO ETABS 22): 1 = Columna, 2 = Viga, 3 = Brace.
        o = ints_de(desanidar(sap_model.FrameObj.GetDesignOrientation(f, 0)))
        return o[0] if o else 0

    objetivo = []
    for f in frames:
        ori = orient(f)
        if TIPO == "vigas" and ori != 2:
            continue
        if TIPO == "columnas" and ori != 1:
            continue
        if TIPO == "todas" and ori not in (1, 2):
            continue
        objetivo.append(f)
    if not objetivo:
        raise RuntimeError("No se encontraron frames del tipo '%s'." % TIPO)
    n_col = sum(1 for f in objetivo if orient(f) == 1)
    n_vig = sum(1 for f in objetivo if orient(f) == 2)

    # SELECCIONAR (como en el GUI: primero se seleccionan los frames).
    try:
        sap_model.SelectObj.ClearSelection()
        for f in objetivo:
            sap_model.FrameObj.SetSelected(f, True)
    except Exception:
        pass

    if AUTO:
        # Automatic from Connectivity + factor de zona rigida -> por TABLA (la API con auto
        # NO guarda el factor). OffsetOpt="Auto", RigidFact=RZ; OffsetI/J los calcula ETABS.
        db = sap_model.DatabaseTables
        CL = "Frame Assignments - End Length Offsets"
        pe = desanidar(db.GetTableForEditingArray(CL, "", 0, [], 0, []))
        ver = pe[0]; campos = [str(c) for c in pe[1]]; idx = {c: i for i, c in enumerate(campos)}
        filas = []
        for f in objetivo:
            row = [""] * len(campos)
            row[idx["UniqueName"]] = f
            row[idx["OffsetOpt"]] = "Auto"
            if "RigidFact" in idx:
                row[idx["RigidFact"]] = str(RZ)
            if "SelfWtOpt" in idx:
                row[idx["SelfWtOpt"]] = "Auto"
            filas.append(row)
        desanidar(db.SetTableForEditingArray(CL, ver, campos, len(filas), [c for fr in filas for c in fr]))
        ap = ints_de(desanidar(db.ApplyEditedTables(True, 0, 0, 0, 0, "")))
        if ap and ap[0] != 0:
            raise RuntimeError("End offset: ApplyEditedTables reporto %d errores fatales." % ap[0])
    else:
        # Definir longitudes: la API SI persiste el factor con AutoOffset=False (validado).
        for f in objetivo:
            verificar_retorno(ret_de(desanidar(sap_model.FrameObj.SetEndLengthOffset(f, False, LEN_I, LEN_J, RZ))),
                              "End offset en " + f)

    sap_model.View.RefreshView(0, False)
    modo = "Automatico (conectividad)" if AUTO else ("Longitudes I=%s J=%s" % (LEN_I, LEN_J))
    print("END LENGTH OFFSET [%s, factor zona rigida %s] -> %d frames: %d columnas + %d vigas."
          % (modo, RZ, len(objetivo), n_col, n_vig))
`;
}

// RELEASE / liberacion de momentos en VIGAS. Como en el GUI (Assign > Frame > Releases) se aplica
// a la SELECCION: el usuario selecciona las vigas en ETABS y la API lee SelectObj.GetSelected
// (ObjectType 2 = Frame). Tambien admite todas las vigas o por seccion. SetReleases(name, II[6],
// JJ[6], ...) con indices U1,U2,U3,R1(torsion),R2(M2),R3(M3)=0..5. OJO: liberar M3 en i y j es
// estable en vigas; ETABS rechaza combinaciones inestables (devuelve != 0) -> se reporta.
function buildReleaseBody({ alcance, soloVigas, filtroSeccion, m3i, m3j, m2i, m2j, torsionJ }) {
  const sec = (filtroSeccion || '').replace(/"/g, '');
  const b = v => v ? 'True' : 'False';
  return `def construir_modelo(sap_model):
    # === ASIGNAR RELEASE (liberacion de momentos) en VIGAS ===
    ALCANCE = "${alcance || 'seleccion'}"     # seleccion | todas | seccion
    SOLO_VIGAS = ${b(soloVigas)}              # filtra a vigas (GetDesignOrientation == 2)
    FILTRO_SECCION = "${sec}"                 # solo si ALCANCE == seccion
    M3_I = ${b(m3i)}; M3_J = ${b(m3j)}        # momento mayor M3 (flexion) en extremo i / j
    M2_I = ${b(m2i)}; M2_J = ${b(m2j)}        # momento menor M2 en i / j
    TOR_J = ${b(torsionJ)}                    # torsion (R1) en j

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ints_de(partes):
        return [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]

    def ret_de(partes):
        e = ints_de(partes)
        return e[-1] if e else -1

    def orient(f):
        # eFrameDesignOrientation (validado ETABS 22): 1 = Columna, 2 = Viga, 3 = Brace.
        o = ints_de(desanidar(sap_model.FrameObj.GetDesignOrientation(f, 0)))
        return o[0] if o else 0

    # 1) FRAMES objetivo segun el alcance
    if ALCANCE == "seleccion":
        sel = desanidar(sap_model.SelectObj.GetSelected(0, [], []))
        tipos = list(sel[1]) if len(sel) > 1 and isinstance(sel[1], (list, tuple)) else []
        nombres = list(sel[2]) if len(sel) > 2 and isinstance(sel[2], (list, tuple)) else []
        objetivo = [str(nombres[i]) for i in range(len(nombres)) if i < len(tipos) and int(tipos[i]) == 2]
        if not objetivo:
            raise RuntimeError("No hay vigas SELECCIONADAS en ETABS. Selecciona las vigas (clic o ventana) en ETABS y vuelve a asignar.")
    else:
        frames = [str(x) for parte in desanidar(sap_model.FrameObj.GetNameList(0, [])) if isinstance(parte, (list, tuple)) for x in parte]
        if not frames:
            raise RuntimeError("No hay frames en el modelo. Dibuja las vigas primero.")
        if ALCANCE == "seccion":
            objetivo = [f for f in frames if str(desanidar(sap_model.FrameObj.GetSection(f, ""))[0]) == FILTRO_SECCION]
            if not objetivo:
                raise RuntimeError("Ningun frame con la seccion '%s'." % FILTRO_SECCION)
        else:
            objetivo = list(frames)

    # 2) filtro a VIGAS (evita liberar columnas por error)
    if SOLO_VIGAS:
        objetivo = [f for f in objetivo if orient(f) == 2]
        if not objetivo:
            raise RuntimeError("Ninguna VIGA en el conjunto (eran columnas/braces). Desmarca 'solo vigas' si es a proposito.")

    # 3) arrays de liberacion (6 GDL: U1,U2,U3,R1,R2,R3)
    ii = [False] * 6; jj = [False] * 6
    if M3_I: ii[5] = True
    if M3_J: jj[5] = True
    if M2_I: ii[4] = True
    if M2_J: jj[4] = True
    if TOR_J: jj[3] = True
    if not any(ii) and not any(jj):
        raise RuntimeError("No elegiste ninguna liberacion (M3 / M2 / torsion). Marca al menos una.")
    cero = [0.0] * 6

    # 4) asignar a cada viga; ETABS rechaza combinaciones inestables (ret != 0) -> se reporta
    ok = 0; errores = []
    for f in objetivo:
        if ret_de(desanidar(sap_model.FrameObj.SetReleases(f, ii, jj, cero, cero))) == 0:
            ok += 1
        else:
            errores.append(f)
    sap_model.View.RefreshView(0, False)
    libs = []
    if M3_I or M3_J: libs.append("M3" + (" i+j" if (M3_I and M3_J) else (" i" if M3_I else " j")))
    if M2_I or M2_J: libs.append("M2" + (" i+j" if (M2_I and M2_J) else (" i" if M2_I else " j")))
    if TOR_J: libs.append("Torsion j")
    print("RELEASE [%s] aplicado a %d viga(s) (de %d objetivo, alcance '%s')." % (", ".join(libs), ok, len(objetivo), ALCANCE))
    if errores:
        print("AVISO: ETABS rechazo la liberacion en %d frame(s) (posible inestabilidad): %s" % (len(errores), errores[:8]))
`;
}

// Diagnostico de la SELECCION (solo lectura): cuantas vigas hay seleccionadas en ETABS.
function buildReleaseCheckBody() {
  return `def construir_modelo(sap_model):
    # === DIAGNOSTICO (solo lectura): vigas seleccionadas en ETABS ===
    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ints_de(partes):
        return [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]

    def orient(f):
        o = ints_de(desanidar(sap_model.FrameObj.GetDesignOrientation(f, 0)))
        return o[0] if o else 0

    sel = desanidar(sap_model.SelectObj.GetSelected(0, [], []))
    tipos = list(sel[1]) if len(sel) > 1 and isinstance(sel[1], (list, tuple)) else []
    nombres = list(sel[2]) if len(sel) > 2 and isinstance(sel[2], (list, tuple)) else []
    frames_sel = [str(nombres[i]) for i in range(len(nombres)) if i < len(tipos) and int(tipos[i]) == 2]
    otros = max(0, len(nombres) - len(frames_sel))
    vigas = sum(1 for f in frames_sel if orient(f) == 2)
    cols = len(frames_sel) - vigas
    if not frames_sel:
        print("No hay FRAMES seleccionados en ETABS. Selecciona las vigas (clic o ventana de seleccion) y vuelve a leer.")
    else:
        print("Seleccionados: %d frame(s) -> %d viga(s) + %d columna(s)%s." % (len(frames_sel), vigas, cols, (" (+%d objeto(s) no-frame)" % otros) if otros else ""))
`;
}

function buildSpectrumBody({ nombreFuncion, z, u, s, tp, tl, r, casoModal, modosMin, modosMax, masaCM, masaCV, casoX, casoY, sfX, sfY, orto30 }) {
  const sfXOrto = orto30 ? Math.round(Number(sfX) * 0.3 * 1e6) / 1e6 : 0;
  const sfYOrto = orto30 ? Math.round(Number(sfY) * 0.3 * 1e6) / 1e6 : 0;
  return `def construir_modelo(sap_model):
    # === ESPECTRO E.030 + MODAL RITZ + MASA + CASOS SISMICOS (validado) ===
    # La API de ETABS 22 NO tiene FuncRS.SetUser: la funcion de usuario se
    # crea via Database Tables ("Functions - Response Spectrum - User Defined").
    NOMBRE_FUNCION = "${nombreFuncion}"
    Z = ${z}        # factor de zona
    U = ${u}        # factor de uso
    S = ${s}        # factor de suelo
    TP = ${tp}      # periodo TP del suelo (s)
    TL = ${tl}      # periodo TL del suelo (s)
    R = ${r}        # coeficiente de reduccion (ya incluye Ia, Ip)
    AMORTIGUAMIENTO = 0.05
    G = 9.80665     # la funcion queda en m/s2 (longitudes del modelo en m)

    CASO_MODAL = "${casoModal}"
    MODOS_MIN = ${modosMin}
    MODOS_MAX = ${modosMax}
    MASA = [("CM", ${masaCM}), ("CV", ${masaCV})]   # masa sismica: patron x factor
    # (caso, dir principal, factor, dir ortogonal, factor ortogonal 0=omitir)
    CASOS = [("${casoX}", "U1", ${sfX}, "U2", ${sfXOrto}), ("${casoY}", "U2", ${sfY}, "U1", ${sfYOrto})]

    PERIODOS = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2,
                0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75,
                0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7,
                1.8, 1.9, 2, 2.25, 2.5, 2.75, 3, 4, 5, 6, 7, 8, 9, 10]

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # Factor de amplificacion sismica C segun E.030 (con la rama corta).
    def c_de(t):
        if t < 0.2 * TP:
            return 1.0 + 7.5 * t / TP
        if t < TP:
            return 2.5
        if t < TL:
            return 2.5 * TP / t
        return 2.5 * TP * TL / (t * t)

    puntos = [(t, Z * U * c_de(t) * S / R * G) for t in PERIODOS]
    print(f"Espectro {NOMBRE_FUNCION}: meseta Sa={Z * U * 2.5 * S / R * G:.4f} m/s2 (ZUCS/R*g)")

    # 0) Verificar que los patrones de la masa existan.
    res = desanidar(sap_model.LoadPatterns.GetNameList(0, []))
    patrones = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    for patron, _ in MASA:
        if patron not in patrones:
            raise RuntimeError(f"El patron '{patron}' (masa sismica) no existe. Define los patrones primero.")

    # 1) Funcion de espectro via tabla (conservando otras funciones de usuario).
    db = sap_model.DatabaseTables
    TABLA = "Functions - Response Spectrum - User Defined"
    g = desanidar(db.GetTableForEditingArray(TABLA, "", 0, [], 0, []))
    version = next((p for p in g if isinstance(p, int) and not isinstance(p, bool)), 1)
    campos = [str(c) for c in (next((p for p in g if isinstance(p, (list, tuple))), []) or [])]
    if not campos:
        raise RuntimeError(f"La tabla '{TABLA}' no devolvio campos.")
    listas = [list(p) for p in g if isinstance(p, (list, tuple))]
    datos_prev = [str(d) for d in (listas[1] if len(listas) > 1 else [])]
    nc = len(campos)
    filas_prev = [datos_prev[i * nc:(i + 1) * nc] for i in range(len(datos_prev) // nc)]
    idx_nombre = next(i for i, c in enumerate(campos) if "name" in c.lower())
    otras = [f for f in filas_prev if f[idx_nombre] != NOMBRE_FUNCION]

    filas = list(otras)
    for periodo, sa in puntos:
        fila = []
        for c in campos:
            cl = c.lower()
            if "name" in cl:
                fila.append(NOMBRE_FUNCION)
            elif "period" in cl or "time" in cl:
                fila.append(str(periodo))
            elif "value" in cl or "accel" in cl:
                fila.append(str(round(sa, 6)))
            elif "damp" in cl:
                fila.append(str(AMORTIGUAMIENTO))
            else:
                fila.append("")
        filas.append(fila)
    datos = [celda for fila in filas for celda in fila]
    verificar_retorno(ret_de(desanidar(db.SetTableForEditingArray(TABLA, version, campos, len(filas), datos))), "SetTable espectro")
    ra = desanidar(db.ApplyEditedTables(True, 0, 0, 0, 0, ""))
    enteros = [p for p in ra if isinstance(p, int) and not isinstance(p, bool)]
    if enteros and enteros[0] > 0:
        log = [x for x in ra if isinstance(x, str)]
        raise RuntimeError(f"ApplyEditedTables con errores fatales: {enteros} {log[0][:300] if log else ''}")

    # Verificacion: la funcion existe y tiene todos los puntos.
    rv = desanidar(sap_model.Func.GetValues(NOMBRE_FUNCION, 0, [], []))
    verificar_retorno(ret_de(rv), f"Verificar funcion {NOMBRE_FUNCION}")
    n_pts = next(x for x in rv if isinstance(x, int) and not isinstance(x, bool))
    if n_pts != len(puntos):
        raise RuntimeError(f"La funcion tiene {n_pts} puntos, se esperaban {len(puntos)}.")
    print(f"Funcion {NOMBRE_FUNCION} verificada: {n_pts} puntos.")

    # 2) Caso modal Ritz (recomendado por CSI para espectros).
    lc = sap_model.LoadCases
    verificar_retorno(lc.ModalRitz.SetCase(CASO_MODAL), f"Caso modal Ritz {CASO_MODAL}")
    verificar_retorno(lc.ModalRitz.SetNumberModes(CASO_MODAL, MODOS_MAX, MODOS_MIN), "Numero de modos")
    r = desanidar(lc.ModalRitz.SetLoads(CASO_MODAL, 2, ["Accel", "Accel"], ["UX", "UY"], [0, 0], [99.0, 99.0]))
    verificar_retorno(ret_de(r), "Cargas Ritz UX/UY")

    # 3) Masa sismica (E.030: 100% CM + %CV segun categoria).
    factores = [f for _, f in MASA]
    nombres_masa = [p for p, _ in MASA]
    r = desanidar(sap_model.PropMaterial.SetMassSource_1(False, False, True, len(MASA), nombres_masa, factores))
    verificar_retorno(ret_de(r), "Masa sismica")

    # 4) Casos de respuesta espectral (idempotentes: SetCase los reinicia).
    rs = lc.ResponseSpectrum
    for caso, dir1, sf1, dir2, sf2 in CASOS:
        verificar_retorno(rs.SetCase(caso), f"Crear caso {caso}")
        if sf2:
            dirs, funcs, sfs = [dir1, dir2], [NOMBRE_FUNCION, NOMBRE_FUNCION], [sf1, sf2]
        else:
            dirs, funcs, sfs = [dir1], [NOMBRE_FUNCION], [sf1]
        r = desanidar(rs.SetLoads(caso, len(dirs), dirs, funcs, sfs, ["Global"] * len(dirs), [0.0] * len(dirs)))
        verificar_retorno(ret_de(r), f"Cargas del caso {caso}")
        verificar_retorno(rs.SetModalCase(caso, CASO_MODAL), f"Caso modal de {caso}")
        # El amortiguamiento constante por defecto es 0.05 (la API 22 no tiene setter).
        rl = desanidar(rs.GetLoads(caso, 0, [], [], [], [], []))
        verificar_retorno(ret_de(rl), f"Verificar caso {caso}")
        print(f"Caso {caso} OK: {dirs} con factores {sfs} sobre {NOMBRE_FUNCION}.")

    print(f"ESPECTRO Y SISMO OK: funcion {NOMBRE_FUNCION} ({len(puntos)} ptos), {CASO_MODAL} Ritz {MODOS_MIN}-{MODOS_MAX}, masa {MASA}, casos {[c[0] for c in CASOS]}")`;
}

// Analizar el modelo: guardar (obligatorio para ETABS) + RunAnalysis +
// estado de los casos. Validado en sandbox v3 (analisis real de 15 s).
// La IA nunca genera esto sola (regla 10): el boton es el pedido explicito.
function buildAnalyzeBody({ rutaGuardado, nombreProyecto }) {
  const proyLimpio = (String(nombreProyecto || 'modelo').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'modelo');
  return `def construir_modelo(sap_model):
    # === ANALIZAR EL MODELO (File.Save + RunAnalysis, validado) ===
    import os
    RUTA_GUARDADO = r"${String(rutaGuardado || '').replace(/"/g, '')}"   # vacio = guardado automatico
    NOMBRE_PROYECTO = "${proyLimpio}"

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # 1) Guardar: ETABS EXIGE un archivo en disco antes de analizar. Si el modelo
    #    esta "(Untitled)" se guarda AUTOMATICAMENTE en Documentos/ETABS_API_modelos.
    nombre = str(sap_model.GetModelFilename() or "")
    ya_guardado = nombre.lower().endswith((".edb", ".ebs"))
    ruta = RUTA_GUARDADO
    if not ruta and not ya_guardado:
        carpeta = os.path.join(os.path.expanduser("~"), "Documents", "ETABS_API_modelos")
        os.makedirs(carpeta, exist_ok=True)
        ruta = os.path.join(carpeta, NOMBRE_PROYECTO + ".EDB")
    if ruta:
        verificar_retorno(sap_model.File.Save(ruta), "Guardar modelo en " + ruta)
        print("Modelo guardado en: " + ruta)
    else:
        verificar_retorno(sap_model.File.Save(""), "Guardar modelo (archivo actual)")
        print("Modelo guardado: " + nombre)

    # 2) Correr el analisis (puede tardar segun el tamano del modelo).
    inicio = time.time()
    verificar_retorno(sap_model.Analyze.RunAnalysis(), "RunAnalysis")
    print(f"Analisis completado en {time.time() - inicio:.0f} s.")

    # 3) Verificacion post-ejecucion: estado de cada caso (4 = terminado).
    r = desanidar(sap_model.Analyze.GetCaseStatus(0, [], []))
    verificar_retorno(ret_de(r), "Leer estado de los casos")
    nombres = list(r[1]) if isinstance(r[1], (list, tuple)) else []
    estados = list(r[2]) if isinstance(r[2], (list, tuple)) else []
    textos = {1: "sin correr", 2: "NO PUDO INICIAR", 3: "NO TERMINO", 4: "terminado"}
    fallidos = []
    for n, e in zip(nombres, estados):
        print(f"   Caso {n}: {textos.get(int(e), e)}")
        if int(e) in (2, 3):
            fallidos.append(str(n))
    if fallidos:
        raise RuntimeError(f"Casos con problema: {fallidos}. Revisa apoyos, masa y cargas.")
    print("ANALISIS OK: revisa la pestana Resultados para los chequeos E.030.")`;
}

// 2DO ANALISIS SISMICO: tras verificar el sistema (R0) y las irregularidades (Ia/Ip), R = R0*Ia*Ip
// cambio -> el espectro (Sa = ZUCS*g/R) y los factores de deriva tambien. Este paso DESBLOQUEA el
// modelo, RE-APLICA el espectro y las combinaciones (con el R ya corregido) y RE-CORRE el analisis.
// Reusa los 3 builders validados renombrando su construir_modelo y llamandolos en secuencia.
function buildSegundoAnalisisBody(espectroBody, combosBody, analisisBody) {
  const esp = espectroBody.replace('def construir_modelo(sap_model):', 'def _seg_espectro(sap_model):');
  const com = combosBody.replace('def construir_modelo(sap_model):', 'def _seg_combos(sap_model):');
  const ana = analisisBody.replace('def construir_modelo(sap_model):', 'def _seg_analisis(sap_model):');
  return `${esp}

${com}

${ana}

def construir_modelo(sap_model):
    # === 2DO ANALISIS SISMICO: re-aplicar espectro + combos (R corregido) y re-analizar ===
    try:
        sap_model.SetModelIsLocked(False)
        print("Modelo desbloqueado para el 2do analisis (el 1er analisis se descarta).")
    except Exception as e:
        print("Aviso al desbloquear:", e)
    print("--- (1/3) Re-aplicando ESPECTRO con el R corregido ---")
    _seg_espectro(sap_model)
    print("--- (2/3) Re-aplicando COMBINACIONES (factores de deriva) ---")
    _seg_combos(sap_model)
    print("--- (3/3) Re-corriendo el ANALISIS ---")
    _seg_analisis(sap_model)
    print("2DO ANALISIS COMPLETADO con el R corregido. Revisa la pestana Resultados.")`;
}

// Apoyos en la base: detecta los puntos en z = base y les asigna restricciones.
// Firmas oficiales: GetCoordCartesian (ByRef X,Y,Z) y SetRestraint(Name, bool[6]).
function buildSupportsBody({ empotrado }) {
  return `def construir_modelo(sap_model):
    # === APOYOS EN LA BASE (firmas oficiales ETABS 22) ===
    EMPOTRADO = ${empotrado ? 'True' : 'False'}  # True: 6 GDL fijos | False: articulado (solo traslaciones)
    TOLERANCIA = 0.01  # m

    # Coordenadas en metros (kgf-m).
    sap_model.SetPresentUnits(8)   # kgf, m, C

    def desanidar(resultado):
        partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
        while len(partes) == 1 and isinstance(partes[0], (list, tuple)):
            partes = list(partes[0])
        return partes

    def ret_de(partes):
        enteros = [p for p in partes if isinstance(p, int) and not isinstance(p, bool)]
        return enteros[-1] if enteros else -1

    # 1) Elevacion de la base del modelo.
    res = desanidar(sap_model.Story.GetStories_2(0.0, 0, [], [], [], [], [], [], [], []))
    base = float(res[0])
    print(f"Elevacion de base: {base}")

    # 2) Todos los puntos del modelo.
    res = desanidar(sap_model.PointObj.GetNameList(0, []))
    nombres = [str(x) for parte in res if isinstance(parte, (list, tuple)) for x in parte]
    if not nombres:
        raise RuntimeError("El modelo no tiene puntos. Dibuja los porticos primero (paso 5).")
    print(f"Puntos en el modelo: {len(nombres)}")

    # 3) Restriccion: [UX, UY, UZ, RX, RY, RZ]
    restriccion = [True, True, True, True, True, True] if EMPOTRADO else [True, True, True, False, False, False]

    aplicados = 0
    primero = None
    for nombre in nombres:
        c = desanidar(sap_model.PointObj.GetCoordCartesian(nombre, 0.0, 0.0, 0.0, "Global"))
        flotantes = [p for p in c if isinstance(p, float)]
        verificar_retorno(ret_de(c), f"Leer coordenadas del punto {nombre}")
        z = flotantes[2]
        if abs(z - base) <= TOLERANCIA:
            r = desanidar(sap_model.PointObj.SetRestraint(nombre, restriccion, 0))
            verificar_retorno(ret_de(r), f"Apoyo en punto {nombre}")
            if primero is None:
                primero = nombre
            aplicados += 1

    if aplicados == 0:
        raise RuntimeError(f"No se encontraron puntos en z={base}. Revisa la elevacion de base.")

    # 4) Verificacion post-ejecucion: releer el primer apoyo.
    chk = desanidar(sap_model.PointObj.GetRestraint(primero, []))
    verificar_retorno(ret_de(chk), "Verificar apoyo")
    leido = [bool(b) for parte in chk if isinstance(parte, (list, tuple)) for b in parte]
    if leido != restriccion:
        raise RuntimeError(f"La restriccion releida {leido} no coincide con la esperada {restriccion}.")

    sap_model.View.RefreshView(0, False)
    tipo = "EMPOTRADOS (6 GDL)" if EMPOTRADO else "ARTICULADOS (traslaciones)"
    print(f"APOYOS {tipo} APLICADOS Y VERIFICADOS: {aplicados} puntos en la base (z={base})")`;
}

const DEFAULT_API_CONTEXT = `CONTEXTO DE API ETABS / CSi API (SCRIPTS COMPLETOS Y AUTONOMOS)

OBJETIVO:
El codigo generado debe ser un SCRIPT DE PYTHON COMPLETO que funcione igual:
  - ejecutado dentro de la aplicacion, y
  - ejecutado directamente desde cmd con: python archivo.py
Por eso el script debe conectarse a ETABS por si mismo. No existe ningun
SapModel inyectado por el servidor; el script lo crea.

ESTRUCTURA OBLIGATORIA DEL SCRIPT:
1. import comtypes.client  (y os/pathlib si hace falta)
2. Una funcion verificar_retorno(ret, accion) que valide ret == 0.
3. Una funcion que conecte/abra ETABS y devuelva (etabs_object, sap_model).
4. La logica de modelado usando sap_model.
5. Bloque final: if __name__ == "__main__": main()

ARQUITECTURA DE COMPOSICION (importante):
La app ensambla el script final. El BLOQUE BASE (imports, RUTA_ETABS, UNIDADES,
conexion validada y main()) lo genera la app automaticamente segun el modo.
TU SOLO escribes la funcion construir_modelo(sap_model).

FUNCIONES YA DISPONIBLES EN EL BLOQUE BASE (usalas, NO las redefinas):
- verificar_retorno(ret, accion): valida ret == 0 o lanza RuntimeError.
- reintentar(funcion, accion, intentos=3, espera=2.0): reintenta llamadas con
  fallos transitorios. USO OBLIGATORIO en la primera llamada que crea modelo.
- conectar_y_preparar_modelo(unidades): conexion + InitializeNewModel (la llama main).
- iniciar_etabs_nuevo(): abre ETABS 22 (la usa la conexion).
- time (modulo), RUTA_ETABS, UNIDADES.
main() ya hace: conectar_y_preparar_modelo -> construir_modelo(sap_model) -> SetPresentUnits.

UNIDADES:
- 6 = kN, m, C.  12 = Ton, m, C.
- Si el usuario pide kN, m, C usar SapModel.SetPresentUnits(6). Nunca 12 para kN.

PRIMER PASO DENTRO DE construir_modelo (en modos de modelo nuevo):
# InitializeNewModel YA fue llamado por el bloque base. Crea el modelo con
# UNA SOLA de estas opciones, SIEMPRE con reintentar() (errores transitorios):

# Grilla UNIFORME -> NewGridOnly:
ret = reintentar(lambda: sap_model.File.NewGridOnly(NumPisos, AltTipica, AltPrimerPiso, NumLineasX, NumLineasY, EspaciamientoX, EspaciamientoY), "Crear grilla")
verificar_retorno(ret, "Crear grilla")

# O modelo en blanco sin grilla -> NewBlank:
ret = reintentar(lambda: sap_model.File.NewBlank(), "Crear modelo en blanco")
verificar_retorno(ret, "Crear modelo en blanco")

REGLA QUE EVITA CRASHES (verificada empiricamente):
- NUNCA llames NewGridOnly y NewBlank en el mismo script. NewGridOnly con un
  modelo ya creado CRASHEA el proceso entero de ETABS (error RPC, sin ret).
  Elige UNO: NewGridOnly (modelo nuevo con grilla) o NewBlank (modelo vacio).
- En modo "modelo actual" NO llames ninguno de los dos.

GRILLAS - REGLAS CRITICAS (causa frecuente de errores):
- SetGridLine, SetGridLines y SetGridSys con listas de coordenadas NO EXISTEN
  en la API de ETABS. NO los uses NUNCA (dan KeyError / COMError).
- NewGridOnly SOLO crea grillas de espaciamiento UNIFORME (un solo dX y un solo dY).
  NO sirve para espaciamientos distintos (ej: 2m, 4m, 3m).
- Para grilla NO UNIFORME hay que editar las Database Tables, SIEMPRE en este
  orden: 1) GetTableForEditingArray para LEER campos y filas reales,
  2) modificar los datos, 3) SetTableForEditingArray, 4) ApplyEditedTables.
  PROHIBIDO saltarse el paso 1: los nombres de campos NO se adivinan.
- REGLAS DE DatabaseTables (errores ya sufridos):
  * SetTableForEditingArray(TableKey, TableVersion, FieldsKeysIncluded, NumberRecords, TableData)
    NO tiene parametro GroupName. NO inventes parametros.
  * TableData es una lista PLANA de strings (fila1campo1, fila1campo2, ...,
    fila2campo1, ...). NUNCA una lista de listas.
  * En Python comtypes los ByRef SE PASAN como relleno (0, 0.0, "", []) en su
    posicion, y las salidas vuelven en la tupla ANIDADA (desanidar); el ret es
    el ultimo entero.
  Si no estas seguro, propon grilla uniforme con NewGridOnly y declaralo en warnings.

PATRONES UTILES:
ret = sap_model.PropMaterial.SetMaterial("CONC_FC210", 2); verificar_retorno(ret, "Material concreto")
ret = sap_model.PropFrame.SetRectangle("COL_30x30", "CONC_FC210", 0.30, 0.30); verificar_retorno(ret, "Seccion")
ret = sap_model.PointObj.AddCartesian(x, y, z, "", nombre); verificar_retorno(ret, "Punto")

REGLAS CRITICAS:
- NO inventes metodos. Si un metodo no esta en esta guia ni en los FLUJOS VALIDADOS, declara la duda en warnings.
- NO ejecutar RunAnalysis salvo pedido explicito.
- Verificar SIEMPRE el ret con verificar_retorno(ret, "accion").
- El script debe poder guardarse y correrse tal cual desde cmd.
`;

const DEFAULT_CODE = `# Script ETABS completo y autonomo.
# Funciona igual en la aplicacion y ejecutado desde cmd: python archivo.py
import comtypes.client

RUTA_ETABS = r"C:\\Program Files\\Computers and Structures\\ETABS 22\\ETABS.exe"

# Configuracion
UNIDADES = 6                  # 6 = kN, m, C
NUMERO_PISOS = 4
ALTURA_PISO_TIPICO = 3.00     # metros
ALTURA_PRIMER_PISO = 3.50     # metros
NUMERO_LINEAS_X = 5
NUMERO_LINEAS_Y = 4
ESPACIAMIENTO_X = 5.00        # metros
ESPACIAMIENTO_Y = 4.00        # metros


def verificar_retorno(ret, accion):
    if ret != 0:
        raise RuntimeError(f"Error en {accion}. Codigo ret={ret}")


def iniciar_etabs():
    # CreateObject puede devolver None sin lanzar excepcion: validar siempre.
    helper = comtypes.client.CreateObject("ETABSv1.Helper")
    etabs = None
    try:
        etabs = helper.CreateObject(RUTA_ETABS)
    except Exception:
        etabs = None
    if etabs is None:
        etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
    if etabs is None:
        raise RuntimeError("No se pudo crear la instancia de ETABS. Verifica RUTA_ETABS.")

    ret = etabs.ApplicationStart()
    verificar_retorno(ret, "Iniciar ETABS")
    return etabs, etabs.SapModel


def main():
    print("Iniciando ETABS...")
    etabs, sap_model = iniciar_etabs()

    # InitializeNewModel debe ir ANTES de cualquier otra llamada a SapModel.
    ret = sap_model.InitializeNewModel(UNIDADES)
    verificar_retorno(ret, "Inicializar modelo nuevo")

    print("Creando grilla...")
    ret = sap_model.File.NewGridOnly(
        NUMERO_PISOS,
        ALTURA_PISO_TIPICO,
        ALTURA_PRIMER_PISO,
        NUMERO_LINEAS_X,
        NUMERO_LINEAS_Y,
        ESPACIAMIENTO_X,
        ESPACIAMIENTO_Y
    )
    verificar_retorno(ret, "Crear grilla con NewGridOnly")

    ret = sap_model.SetPresentUnits(UNIDADES)
    verificar_retorno(ret, "Definir unidades visibles")

    print("Modelo con grilla creado correctamente.")
    print("ETABS queda abierto para revisar la grilla.")


if __name__ == "__main__":
    main()
`;

// ============================================================
// FLUJOS VALIDADOS (golden patterns)
// Codigo probado manualmente. La IA los usa como guia.
// ============================================================

function buildGridScript({
  unidades = 6,
  numeroPisos = 4,
  alturaTipica = 3.0,
  alturaPrimerPiso = 3.5,
  lineasX = 5,
  lineasY = 4,
  espaciamientoX = 5.0,
  espaciamientoY = 4.0
} = {}) {
  return `# FLUJO VALIDADO: Crear modelo nuevo con grilla rectangular (NewGridOnly)
import comtypes.client

RUTA_ETABS = r"C:\\Program Files\\Computers and Structures\\ETABS 22\\ETABS.exe"

UNIDADES = ${unidades}                  # 6 = kN, m, C
NUMERO_PISOS = ${numeroPisos}
ALTURA_PISO_TIPICO = ${Number(alturaTipica).toFixed(2)}     # metros
ALTURA_PRIMER_PISO = ${Number(alturaPrimerPiso).toFixed(2)}     # metros
NUMERO_LINEAS_X = ${lineasX}
NUMERO_LINEAS_Y = ${lineasY}
ESPACIAMIENTO_X = ${Number(espaciamientoX).toFixed(2)}        # metros
ESPACIAMIENTO_Y = ${Number(espaciamientoY).toFixed(2)}        # metros


def verificar_retorno(ret, accion):
    if ret != 0:
        raise RuntimeError(f"Error en {accion}. Codigo ret={ret}")


def iniciar_etabs():
    # CreateObject puede devolver None sin lanzar excepcion: validar siempre.
    helper = comtypes.client.CreateObject("ETABSv1.Helper")
    etabs = None
    try:
        etabs = helper.CreateObject(RUTA_ETABS)
    except Exception:
        etabs = None
    if etabs is None:
        etabs = helper.CreateObjectProgID("CSI.ETABS.API.ETABSObject")
    if etabs is None:
        raise RuntimeError("No se pudo crear la instancia de ETABS. Verifica RUTA_ETABS.")
    ret = etabs.ApplicationStart()
    verificar_retorno(ret, "Iniciar ETABS")
    return etabs, etabs.SapModel


def main():
    print("Iniciando ETABS...")
    etabs, sap_model = iniciar_etabs()

    # InitializeNewModel SIEMPRE antes de cualquier otra llamada a SapModel.
    ret = sap_model.InitializeNewModel(UNIDADES)
    verificar_retorno(ret, "Inicializar modelo nuevo")

    print("Creando grilla...")
    ret = sap_model.File.NewGridOnly(
        NUMERO_PISOS,
        ALTURA_PISO_TIPICO,
        ALTURA_PRIMER_PISO,
        NUMERO_LINEAS_X,
        NUMERO_LINEAS_Y,
        ESPACIAMIENTO_X,
        ESPACIAMIENTO_Y
    )
    verificar_retorno(ret, "Crear grilla con NewGridOnly")

    ret = sap_model.SetPresentUnits(UNIDADES)
    verificar_retorno(ret, "Definir unidades visibles")

    print("Modelo con grilla creado correctamente.")
    print("ETABS queda abierto para revisar la grilla.")


if __name__ == "__main__":
    main()
`;
}

function splitKeys(value) {
  return String(value || '').split(/[\n,;]+/).map(k => k.trim()).filter(Boolean);
}

function normalizeModelId(value) {
  return String(value || '').trim().replace(/^models\//, '');
}

function getMode(value) {
  return SESSION_MODES.find(mode => mode.value === value) || SESSION_MODES[0];
}

const MODEL_OPTIONS_BY_PROVIDER = {
  gemini: GEMINI_MODEL_OPTIONS,
  openai: OPENAI_MODEL_OPTIONS,
  anthropic: ANTHROPIC_MODEL_OPTIONS
};

// Resumen legible del resultado de una herramienta, para la tarjeta del chat.
function resumirResultadoTool(r) {
  if (r == null) return 'sin datos';
  if (typeof r === 'string') return r.slice(0, 200);
  if (Array.isArray(r)) return `${r.length} resultado(s)`;
  if (r.error) return `Error: ${String(r.error).slice(0, 180)}`;
  if (r.bloqueado_antes_de_ejecutar) return `Bloqueado: ${(r.problemas || []).join(' · ').slice(0, 200)}`;
  if (r.exito === true) return `Ejecutado OK${r.segundos != null ? ` (${r.segundos}s)` : ''}. ${String(r.salida || '').trim().split('\n').slice(-2).join(' ').slice(0, 200)}`;
  if (r.exito === false) return `Fallo: ${String(r.error || '').slice(0, 180)}`;
  if (r.resultados?.chequeos) {
    const c = r.resultados.chequeos;
    return `Masa 90%: ${c.masa_90?.cumple ? 'OK' : 'NO'} · Derivas: ${c.derivas?.cumple ? 'OK' : 'NO'}`;
  }
  if (r.modelo) return `Modelo: ${r.modelo} · ${r.num_frames ?? '?'} frames`;
  if (r.codigo) return `${r.nombre || 'flujo'} (${String(r.codigo).length} chars de codigo)`;
  return JSON.stringify(r).slice(0, 200);
}

// ============================================================
// MEMORIA DE CALCULO — DEFINICION DE MATERIALES (E.060 / ACI 318-19)
// Determinista: calcula Ec, Gc, nu, fu, fye y arma (a) lineas para render
// en la app (KaTeX) y (b) un documento LaTeX descargable. Mismas formulas
// de las imagenes del usuario. Todo en kgf-cm.
// ============================================================
function buildMemoriaMateriales({ norma, fc, fy, gammaC, gammaS, es, poisson, encabezadoIzq, encabezadoDer }) {
  const FC = Number(fc) || 280, FY = Number(fy) || 4200;
  const GC = Number(gammaC) || 2400, GS = Number(gammaS) || 7850;
  const ES = Number(es) || 2000000;
  const esACI = norma === 'ACI';
  const coefE = esACI ? 15100 : 15000;
  const Ec = coefE * Math.sqrt(FC);
  let nu, Gc, refGc, refNu;
  if (esACI) {
    nu = Number(poisson) || 0.20;
    Gc = Ec / (2 * (nu + 1));
    refGc = 'ACI-318-19 (Art. 19.2.2.1)';
    refNu = 'dato (Modulo de Poisson)';
  } else {
    Gc = Ec / 2.3;
    nu = Ec / (2 * Gc) - 1;
    refGc = 'Formula 8.4 de la norma E.060';
    refNu = 'Formula de resistencia de materiales';
  }
  const fu = 1.5 * FY, fye = 1.1 * FY, fyte = 1.1 * fu;
  const refE = esACI ? 'ACI-318-19 (Art. 19.2.2.1b)' : 'Formula 8.3 de la norma E.060';
  const refEs = esACI ? 'ACI-318-19 (Art. 20.2.2.2)' : 'norma E.060 (Art. 8.5.5)';
  const titulo = esACI ? 'DEFINICION DE MATERIALES (ACI 318-19)' : 'DEFINICION DE MATERIALES (E.060 - Peru)';
  const f3 = x => x.toFixed(3), f2 = x => x.toFixed(2), kInt = x => String(Math.round(x));

  // Unidades en REDONDA (\\mathrm), NEGRITA y AZUL como en Mathcad, y como
  // fraccion display (\\dfrac) para que se vean claras. Las unidades nunca van
  // en cursiva; las variables si (f'_c, E_c).
  const AZUL = '#1d4ed8';
  const U = (a, b) => `\\;\\textcolor{${AZUL}}{\\mathbf{\\dfrac{${a}}{${b}}}}`;
  const KGCM = U('kgf', 'cm^{2}'), KGM3 = U('kgf', 'm^{3}');

  // (a) Lineas para render en la app. kind: input | head | calc.
  const lineas = [
    { kind: 'input', desc: 'Resistencia a compresion simple del concreto', tex: `f'_c := ${kInt(FC)}${KGCM}` },
    { kind: 'input', desc: 'Peso especifico del concreto armado', tex: `\\gamma_c := ${kInt(GC)}${KGM3}` },
  ];
  if (esACI) lineas.push({ kind: 'input', desc: 'Peso especifico del acero', tex: `\\gamma_s := ${kInt(GS)}${KGM3}` });
  if (esACI) lineas.push({ kind: 'input', desc: 'Modulo de Poisson del concreto', tex: `\\nu_c := ${f2(nu)}` });
  lineas.push({ kind: 'input', desc: 'Esfuerzo de fluencia del acero', tex: `f_y := ${kInt(FY)}${KGCM}` });
  lineas.push({ kind: 'input', desc: `Modulo de elasticidad del acero  (${refEs})`, tex: `E_s := ${kInt(ES)}${KGCM}` });
  lineas.push({ kind: 'head', desc: 'Modulo de elasticidad del concreto' });
  lineas.push({ kind: 'calc', desc: refE, tex: `E_c := ${coefE}\\,\\sqrt{f'_c\\cdot\\textcolor{${AZUL}}{\\mathbf{\\dfrac{kgf}{cm^{2}}}}} = ${f3(Ec)}${KGCM}` });
  lineas.push({ kind: 'head', desc: 'Modulo de rigidez al esfuerzo cortante del concreto' });
  lineas.push({ kind: 'calc', desc: refGc, tex: esACI ? `G_c := \\dfrac{E_c}{2\\,(\\nu_c+1)} = ${f3(Gc)}${KGCM}` : `G_c := \\dfrac{E_c}{2.3} = ${f3(Gc)}${KGCM}` });
  if (!esACI) {
    lineas.push({ kind: 'head', desc: 'Modulo de Poisson del concreto' });
    lineas.push({ kind: 'calc', desc: refNu, tex: `\\nu_c := \\dfrac{E_c}{2\\,G_c} - 1 = ${f2(nu)}` });
  }
  lineas.push({ kind: 'head', desc: 'Esfuerzos del acero de refuerzo' });
  lineas.push({ kind: 'calc', desc: 'Esfuerzo a la traccion minima', tex: `f_u := 1.5\\,f_y = ${kInt(fu)}${KGCM}` });
  lineas.push({ kind: 'calc', desc: 'Esfuerzo de fluencia esperado', tex: `f_{ye} := 1.1\\,f_y = ${kInt(fye)}${KGCM}` });
  lineas.push({ kind: 'calc', desc: 'Esfuerzo a la traccion esperada', tex: `f_{yte} := 1.1\\,f_u = ${kInt(fyte)}${KGCM}` });

  // (b) Documento LaTeX standalone. Unidades en \\mathrm (redonda), azul+negrita.
  const uTex = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{\\dfrac{kgf}{cm^{2}}}}';
  const uTexM3 = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{\\dfrac{kgf}{m^{3}}}}';
  const gcLatex = esACI
    ? `G_c := \\frac{E_c}{2\\,(\\nu_c+1)} = ${f3(Gc)}${uTex}`
    : `G_c := \\frac{E_c}{2.3} = ${f3(Gc)}${uTex}`;
  const filasInput = [
    `f'_c &:= ${kInt(FC)}${uTex} & &\\text{Resistencia a compresi\\'on simple del concreto}`,
    `\\gamma_c &:= ${kInt(GC)}${uTexM3} & &\\text{Peso espec\\'ifico del concreto armado}`,
  ];
  if (esACI) filasInput.push(`\\gamma_s &:= ${kInt(GS)}${uTexM3} & &\\text{Peso espec\\'ifico del acero}`);
  if (esACI) filasInput.push(`\\nu_c &:= ${f2(nu)} & &\\text{M\\'odulo de Poisson del concreto}`);
  filasInput.push(`f_y &:= ${kInt(FY)}${uTex} & &\\text{Esfuerzo de fluencia del acero}`);
  filasInput.push(`E_s &:= ${kInt(ES)}${uTex} & &\\text{M\\'odulo de elasticidad del acero}`);

  const latex = `% Memoria de calculo generada por ETABS API + IA
\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{xcolor}
\\usepackage[spanish]{babel}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{fancyhdr}
\\setlength{\\parindent}{0pt}
\\pagestyle{fancy}\\fancyhf{}
\\lhead{\\textbf{${(encabezadoIzq || '').replace(/[\\{}$&#%_^~]/g, '')}}}
\\rhead{${(encabezadoDer || '').replace(/[\\{}$&#%_^~]/g, '')}}
\\cfoot{P\\'agina \\thepage\\ de \\pageref{LastPage}}
\\usepackage{lastpage}
\\renewcommand{\\headrulewidth}{0.6pt}
\\begin{document}
\\begin{center}
{\\large\\textbf{${titulo}}}\\\\[2pt]
\\textbf{1. Caracter\\'isticas de elementos de concreto armado}
\\end{center}
\\vspace{8pt}
\\begin{align*}
${filasInput.join('\\\\[4pt]\n')}
\\end{align*}

\\textbf{M\\'odulo de elasticidad del concreto}
\\[ E_c := ${coefE}\\,\\sqrt{f'_c\\cdot\\textcolor[HTML]{1D4ED8}{\\mathbf{\\tfrac{kgf}{cm^{2}}}}} = ${f3(Ec)}${uTex} \\qquad \\text{(${refE})} \\]

\\textbf{M\\'odulo de rigidez al esfuerzo cortante del concreto}
\\[ ${gcLatex} \\qquad \\text{(${refGc})} \\]
${!esACI ? `
\\textbf{M\\'odulo de Poisson del concreto}
\\[ \\nu_c := \\frac{E_c}{2\\,G_c} - 1 = ${f2(nu)} \\qquad \\text{(${refNu})} \\]
` : ''}
\\vspace{4pt}
\\textbf{Esfuerzos del acero de refuerzo}
\\begin{align*}
f_u &:= 1.5\\,f_y = ${kInt(fu)}${uTex} & &\\text{Esfuerzo a la tracci\\'on m\\'inima}\\\\[4pt]
f_{ye} &:= 1.1\\,f_y = ${kInt(fye)}${uTex} & &\\text{Esfuerzo de fluencia esperado}\\\\[4pt]
f_{yte} &:= 1.1\\,f_u = ${kInt(fyte)}${uTex} & &\\text{Esfuerzo a la tracci\\'on esperada}
\\end{align*}
\\end{document}
`;

  return { titulo, lineas, latex, valores: { Ec, Gc, nu, fu, fye, fyte } };
}

// Diametros de barra comunes en Peru: etiqueta -> diametro db en cm.
const BARRAS_ACERO = [
  { id: '6mm',    label: '6 mm',   db: 0.6,    area: 0.28 },
  { id: '8mm',    label: '8 mm',   db: 0.8,    area: 0.50 },
  { id: '3/8"',   label: '3/8"',   db: 0.9525, area: 0.71 },
  { id: '12mm',   label: '12 mm',  db: 1.2,    area: 1.13 },
  { id: '1/2"',   label: '1/2"',   db: 1.27,   area: 1.29 },
  { id: '5/8"',   label: '5/8"',   db: 1.5875, area: 1.99 },
  { id: '3/4"',   label: '3/4"',   db: 1.905,  area: 2.84 },
  { id: '1"',     label: '1"',     db: 2.54,   area: 5.10 },
  { id: '1 3/8"', label: '1 3/8"', db: 3.49,   area: 10.06 },
];
const barAcero = id => BARRAS_ACERO.find(b => b.id === id) || BARRAS_ACERO[7];
// Barras listadas en las tablas de ganchos estandar (hasta 1", como la hoja del usuario).
const TABLA_GANCHOS_BARRAS = ['3/8"', '12mm', '1/2"', '5/8"', '3/4"', '1"'];

// Calcula la LONGITUD DE DESARROLLO A TRACCION (E.060 / ACI 318-19) de forma
// deterministica desde los parametros del formulario, reproduciendo la hoja
// Mathcad del usuario: cb, Atr, Ktr, ld (simplificada y general), ldh y ganchos.
function calcDesarrollo(p) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const FC = num(p.fc, 280), FY = num(p.fy, 4200);
  const db = barAcero(p.barra).db, dt = barAcero(p.estribo).db;
  const lam = num(p.lambda, 1), psiT = num(p.psiT, 1.3), psiE = num(p.psiE, 1);
  const psiG = num(p.psiG, 1), psiS = num(p.psiS, 1);
  const r = num(p.r, 4), s = num(p.s, 10), n = num(p.n, 3);
  const sq = Math.sqrt(FC);
  const cb = r + dt + db / 2;                       // separacion/recubrimiento (cm)
  const Atr = 2 * (Math.PI * dt * dt / 4);          // area de refuerzo transversal (cm2)
  const Ktr = (Atr * FY) / (105 * s * n);           // E.060 12-2 / ACI 25.4.2.4b
  const esGrande = db > 1.91;                       // > 3/4"
  const facE060 = esGrande ? 6.6 : 8.2;            // E.060 Tabla 12.1
  const facACI = esGrande ? 5.3 : 6.6;             // ACI 318-19 Tabla 25.4.2.3
  const ldSimple = (FY * psiT * psiE * psiS) / (facE060 * lam * sq) * db;
  const conf = Math.min((cb + Ktr) / db, 2.5);
  const ldGeneral = (FY * psiT * psiE * psiS * psiG) / (3.5 * lam * sq * conf) * db;
  const ldh = (0.075 * psiE * FY) / (lam * sq) * db;   // gancho estandar (cm)
  const L90 = db + 3 * db + 12 * db;               // long. total gancho 90 (cm) = 16 db
  const L180 = db + 3 * db + 4 * db;               // long. total gancho 180 (cm) = 8 db
  // Tablas de ganchos estandar (en mm); el 180 lleva extension minima de 65 mm.
  const tabla = TABLA_GANCHOS_BARRAS.map(id => {
    const b = barAcero(id), dmm = b.db * 10;
    const ext180 = Math.max(4 * dmm, 65);
    return { label: b.label, ext90: Math.round(12 * dmm), l90: Math.round(16 * dmm),
      ext180: Math.round(ext180), l180: Math.round(4 * dmm + ext180) };
  });
  return { FC, FY, db, dt, lam, psiT, psiE, psiG, psiS, r, s, n, sq, cb, Atr, Ktr,
    esGrande, facE060, facACI, ldSimple, conf, ldGeneral, ldh, L90, L180, tabla,
    barra: barAcero(p.barra).label, estribo: barAcero(p.estribo).label };
}

// Documento LaTeX standalone de la memoria de LONGITUD DE DESARROLLO A TRACCION.
function buildMemoriaDesarrollo(p, proyecto = '', { encabezadoIzq = '', encabezadoDer = '' } = {}) {
  const d = calcDesarrollo(p);
  const f3 = x => x.toFixed(3), f2 = x => x.toFixed(2);
  const titulo = 'LONGITUD DE DESARROLLO A TRACCION (E.060 / ACI 318-19)';
  const U2 = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{\\tfrac{kgf}{cm^{2}}}}';
  const UCM = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{cm}}';
  const UCM2 = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{cm^{2}}}';
  const esc = s => (s || '').replace(/[\\{}$&#%_^~]/g, '');
  const filasIn = [
    `f'_c &:= ${Math.round(d.FC)}${U2} & &\\text{Resistencia a compresión del concreto}`,
    `f_y &:= ${Math.round(d.FY)}${U2} & &\\text{Esfuerzo de fluencia del acero}`,
    `d_b &:= ${f3(d.db)}${UCM} & &\\text{Diámetro de la varilla (${esc(d.barra)})}`,
    `\\lambda &:= ${f2(d.lam)} & &\\text{1 concreto normal, 0.75 concreto ligero}`,
    `\\psi_t &:= ${f2(d.psiT)} & &\\text{Factor de posición (1.3 barra superior)}`,
    `\\psi_e &:= ${f2(d.psiE)} & &\\text{Factor de recubrimiento / epóxico}`,
    `\\psi_g &:= ${f2(d.psiG)} & &\\text{Factor de grado del refuerzo}`,
    `\\psi_s &:= ${f2(d.psiS)} & &\\text{Factor de tamaño (0.8 para 3/4'' o menos)}`,
    `r &:= ${f2(d.r)}${UCM} & &\\text{Recubrimiento libre}`,
    `d_t &:= ${f3(d.dt)}${UCM} & &\\text{Diámetro del estribo (${esc(d.estribo)})}`,
    `s &:= ${f2(d.s)}${UCM} & &\\text{Separación de estribos}`,
    `n &:= ${Math.round(d.n)} & &\\text{Número de barras longitudinales}`,
  ];
  const fila90 = t => `${esc(t.label)} & ${t.ext90} & ${t.l90} \\\\`;
  const fila180 = t => `${esc(t.label)} & ${t.ext180} & ${t.l180} \\\\`;
  const latex = `% Memoria de calculo generada por ETABS API + IA
\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{xcolor}
\\usepackage{array}
\\usepackage[spanish]{babel}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\setlength{\\parindent}{0pt}
\\pagestyle{fancy}\\fancyhf{}
\\lhead{\\textbf{${esc(encabezadoIzq)}}}
\\rhead{${esc(encabezadoDer)}}
\\cfoot{P\\'agina \\thepage\\ de \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.6pt}
\\begin{document}
\\begin{center}
{\\large\\textbf{${titulo}}}\\\\[2pt]
\\textbf{Proyecto: ${esc(proyecto) || '---'}}
\\end{center}
\\vspace{6pt}
\\textbf{1. Datos}
\\begin{align*}
${filasIn.join(' \\\\[3pt]\n')}
\\end{align*}
\\textbf{2. C\\'alculos}
\\[ c_b := r + d_t + \\tfrac{d_b}{2} = ${f3(d.cb)}${UCM} \\qquad\\text{(separación/recubrimiento)} \\]
\\[ A_{tr} := 2\\left(\\frac{\\pi\\,d_t^{2}}{4}\\right) = ${f3(d.Atr)}${UCM2} \\qquad\\text{(área de refuerzo transversal)} \\]
\\[ K_{tr} := \\frac{A_{tr}\\,f_y}{105\\,s\\,n} = ${f2(d.Ktr)} \\qquad\\text{(E.060 12-2 / ACI 25.4.2.4b)} \\]
\\textbf{Longitud de desarrollo simplificada (E.060 Tabla 12.1; ACI 25.4.2.3: 6.6 / 5.3):}
\\[ l_d := \\begin{cases} \\dfrac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s}{8.2\\,\\lambda\\sqrt{f'_c}}\\,d_b & d_b \\le 1.91 \\\\[10pt] \\dfrac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s}{6.6\\,\\lambda\\sqrt{f'_c}}\\,d_b & d_b > 1.91 \\end{cases} = ${f3(d.ldSimple)}${UCM} \\]
\\textbf{Longitud de desarrollo general (E.060 12-1 / ACI 25.4.2.4a):}
\\[ l_d := \\frac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s\\,\\psi_g}{3.5\\,\\lambda\\sqrt{f'_c}\\;\\min\\!\\left(\\dfrac{c_b+K_{tr}}{d_b},\\,2.5\\right)}\\,d_b = ${f3(d.ldGeneral)}${UCM} \\]
\\newpage
\\textbf{3. Desarrollo de ganchos est\\'andar a tracci\\'on}
\\[ l_{dh} := \\frac{0.075\\,\\psi_e\\,f_y}{\\lambda\\sqrt{f'_c}}\\,d_b = ${f3(d.ldh)}${UCM} \\]
\\textbf{4. Ganchos est\\'andar (hasta di\\'ametros de 1''):}
\\[ L_{90} := d_b + 3\\,d_b + 12\\,d_b = ${f2(d.L90)}${UCM} \\qquad L_{180} := d_b + 3\\,d_b + 4\\,d_b = ${f2(d.L180)}${UCM} \\]
\\vspace{4pt}
\\begin{center}
\\begin{tabular}{|c|c|c|}
\\hline
\\multicolumn{3}{|c|}{\\textbf{Gancho a 90$^\\circ$}}\\\\
\\hline
\\textbf{Barra ($d_b$)} & \\textbf{12$d_b$ (mm)} & \\textbf{L (mm)}\\\\
\\hline
${d.tabla.map(fila90).join('\n')}
\\hline
\\end{tabular}
\\qquad
\\begin{tabular}{|c|c|c|}
\\hline
\\multicolumn{3}{|c|}{\\textbf{Gancho a 180$^\\circ$}}\\\\
\\hline
\\textbf{Barra ($d_b$)} & \\textbf{4$d_b$ (mm)} & \\textbf{L (mm)}\\\\
\\hline
${d.tabla.map(fila180).join('\n')}
\\hline
\\end{tabular}
\\end{center}
\\end{document}
`;
  return { titulo, latex };
}

// === Diagramas SVG (vectoriales, deterministas) de la memoria de Long. de desarrollo ===
const _COL = { concreto: '#eef2f7', borde: '#5b6b7a', barra: '#1d4ed8', cota: '#b91c1c', txt: '#1a1a1a' };
// Cabeza de flecha de cota (triangulo) apuntando en una direccion.
const _flecha = (x, y, dir) => {
  const s = 4.5;
  const p = dir === 'up' ? `${x},${y} ${x - s},${y + s} ${x + s},${y + s}`
    : dir === 'down' ? `${x},${y} ${x - s},${y - s} ${x + s},${y - s}`
    : dir === 'left' ? `${x},${y} ${x + s},${y - s} ${x + s},${y + s}`
    : `${x},${y} ${x - s},${y - s} ${x - s},${y + s}`;
  return <polygon points={p} fill={_COL.cota} />;
};
// Etiqueta "d_b" (con subindice) para los SVG.
const _dbTxt = (prefix = '') => (<>{prefix}d<tspan dy="2.5" fontSize="8">b</tspan></>);

// Detalle geometrico de un gancho estandar (doblez a 90 o 180 grados), como la hoja del usuario.
function SvgGanchoDetalle({ tipo = '90', width = 230 }) {
  const C = _COL, H = 205, bar = 6;
  const cotaV = (x, y1, y2, label, lx) => (
    <g><line x1={x} y1={y1} x2={x} y2={y2} stroke={C.cota} strokeWidth="0.8" />
      {_flecha(x, y1, 'up')}{_flecha(x, y2, 'down')}
      <text x={lx ?? x + 5} y={(y1 + y2) / 2} fontSize="11" fill={C.txt} dominantBaseline="middle">{label}</text></g>
  );
  const cotaH = (x1, x2, y, label) => (
    <g><line x1={x1} y1={y} x2={x2} y2={y} stroke={C.cota} strokeWidth="0.8" />
      {_flecha(x1, y, 'left')}{_flecha(x2, y, 'right')}
      <text x={(x1 + x2) / 2} y={y + 14} fontSize="11" fill={C.txt} textAnchor="middle">{label}</text></g>
  );
  if (tipo === '180') {
    const xL = 78, xR = 118, yTop = 32, yU = 150, tail = 92;
    const path = `M${xL} ${yTop} L${xL} ${yU} A20 20 0 0 1 ${xR} ${yU} L${xR} ${tail}`;
    return (
      <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
        <text x={width / 2} y={15} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill={C.barra}>DOBLEZ A 180°</text>
        <path d={path} fill="none" stroke={C.barra} strokeWidth={bar} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={(xL + xR) / 2} cy={yU} r="20" fill="none" stroke={C.borde} strokeWidth="0.7" strokeDasharray="3 2" />
        <text x={(xL + xR) / 2} y={yU - 25} textAnchor="middle" fontSize="10" fill={C.txt}>D</text>
        {cotaH(xL - bar / 2, xL + bar / 2, yTop - 9, _dbTxt())}
        {cotaV(xR + 24, tail, yU - 22, _dbTxt('4 '), xR + 29)}
        <text x={xR + 29} y={yU + 4} fontSize="8" fill={C.txt}>(mín. 65 mm)</text>
        {cotaV(xL - 26, yTop, yU + 20, 'L', xL - 42)}
      </svg>
    );
  }
  const xV = 92, yTop = 32, yBend = 150, xTail = 188;
  const path = `M${xV} ${yTop} L${xV} ${yBend - 22} Q${xV} ${yBend} ${xV + 22} ${yBend} L${xTail} ${yBend}`;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      <text x={width / 2} y={15} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill={C.barra}>DOBLEZ A 90°</text>
      <path d={path} fill="none" stroke={C.barra} strokeWidth={bar} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xV + 22} cy={yBend - 22} r="22" fill="none" stroke={C.borde} strokeWidth="0.7" strokeDasharray="3 2" />
      <text x={xV + 40} y={yBend - 24} fontSize="10" fill={C.txt}>D</text>
      {cotaH(xV - bar / 2, xV + bar / 2, yTop - 9, _dbTxt())}
      {cotaH(xV + 22, xTail, yBend + 24, _dbTxt('12 '))}
      {cotaV(xV - 26, yTop, yBend + 20, 'L', xV - 42)}
    </svg>
  );
}

// Anclaje del refuerzo con gancho en la cara del apoyo (seccion critica, ldh).
function SvgAnclajeGancho({ width = 430 }) {
  const C = _COL, H = 200;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      {/* Columna (apoyo) y viga */}
      <rect x="40" y="22" width="58" height="156" fill={C.concreto} stroke={C.borde} strokeWidth="1" />
      <rect x="98" y="72" width="320" height="56" fill={C.concreto} stroke={C.borde} strokeWidth="1" />
      {/* Seccion critica (cara del apoyo) */}
      <line x1="98" y1="50" x2="98" y2="168" stroke={C.borde} strokeWidth="0.9" strokeDasharray="4 3" />
      <text x="103" y="60" fontSize="8.5" fill={C.txt}>Sección crítica para el anclaje</text>
      <text x="103" y="70" fontSize="8.5" fill={C.txt}>de los bastones (cara del apoyo)</text>
      {/* Barra superior que entra a la columna y dobla 90 grados hacia abajo */}
      <path d="M410 84 L80 84 Q62 84 62 102 L62 162" fill="none" stroke={C.barra} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="120" y="150" fontSize="9" fill={C.barra}>Gancho normal doblado a 90° o 180°</text>
      <line x1="118" y1="146" x2="70" y2="130" stroke={C.txt} strokeWidth="0.5" />
      {/* ldh: de la seccion critica al extremo del gancho */}
      <g><line x1="52" y1="40" x2="98" y2="40" stroke={C.cota} strokeWidth="0.8" />
        {_flecha(52, 40, 'left')}{_flecha(98, 40, 'right')}
        <text x="75" y="36" fontSize="11" fill={C.txt} textAnchor="middle">ℓ<tspan dy="2.5" fontSize="8">dh</tspan></text></g>
    </svg>
  );
}

// Concepto: por que se necesita longitud de desarrollo en el apoyo (figuras a y b).
function SvgVigaConcepto({ width = 460 }) {
  const C = _COL, H = 150;
  const panel = (ox, modoB) => {
    const wallX = ox + 158;
    return (
      <g key={ox}>
        {/* Apoyo (muro) con achurado simple */}
        <rect x={wallX} y="36" width="34" height="80" fill={C.concreto} stroke={C.borde} strokeWidth="1" />
        {[0, 1, 2, 3, 4].map(i => <line key={i} x1={wallX} y1={44 + i * 16} x2={wallX + 34} y2={36 + i * 16} stroke={C.borde} strokeWidth="0.4" />)}
        {/* Viga */}
        <rect x={ox + 12} y="52" width="146" height="26" fill={C.concreto} stroke={C.borde} strokeWidth="1" />
        {/* Cargas */}
        {[0, 1, 2].map(i => <g key={i}><line x1={ox + 45 + i * 35} y1="34" x2={ox + 45 + i * 35} y2="50" stroke={C.txt} strokeWidth="0.8" />{_flecha(ox + 45 + i * 35, 50, 'down')}</g>)}
        {/* Barra inferior */}
        <line x1={ox + 16} y1="72" x2={modoB ? wallX + 28 : wallX} y2="72" stroke={C.barra} strokeWidth="3.5" strokeLinecap="round" />
        {modoB ? (
          <g><line x1={wallX} y1="100" x2={wallX + 28} y2="100" stroke={C.cota} strokeWidth="0.8" />
            {_flecha(wallX, 100, 'left')}{_flecha(wallX + 28, 100, 'right')}
            <text x={wallX + 14} y="112" fontSize="9.5" fill={C.txt} textAnchor="middle">ℓ<tspan dy="2" fontSize="7">d</tspan></text>
            <text x={ox + 84} y="130" fontSize="8.5" fill={C.txt} textAnchor="middle">b) Varillas prolongadas ℓd en el empotramiento</text></g>
        ) : (
          <g><text x={wallX - 2} y="70" fontSize="13" fill={C.cota} textAnchor="end" fontWeight="bold">✗</text>
            <text x={ox + 84} y="130" fontSize="8.5" fill={C.txt} textAnchor="middle">a) Sin longitud de desarrollo (la viga fallará)</text></g>
        )}
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      {panel(0, false)}
      {panel(width / 2 - 5, true)}
    </svg>
  );
}

// Calcula el DISEÑO DE FLEXIÓN DE VIGAS (ACI 318-19 / E.060) de forma determinista,
// reproduciendo la hoja Mathcad del usuario (A: refuerzo; B: acero máximo; máximos
// E.060/ACI; C: acero mínimo; D: temperatura; E: necesario; F: acero a colocar).
function calcFlexion(p) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const hv = num(p.hv, 25), b = num(p.b, 10), r = num(p.r, 4), phi0 = num(p.phi, 0.9);
  const fc = num(p.fc, 280), fy = num(p.fy, 4200), Es = num(p.es, 2000000), Mu = num(p.Mu, 0);
  const d = hv - r;
  const disc = d * d - (2 * Mu) / (0.85 * fc * phi0 * b);
  const a = d - Math.sqrt(Math.max(disc, 0));
  const As = (0.85 * fc * a * b) / fy;
  const rho = As / (d * b);
  // B. Verificación del acero máximo (deformaciones)
  const beta1 = Math.min(Math.max(0.85 - (fc - 280) * 0.05 / 70, 0.65), 0.85);
  const c = a / beta1;
  const ecmax = 0.003;
  const et = c > 0 ? ((d - c) / c) * ecmax : 0;
  const eyt = fy / Es;
  const esmin = eyt + 0.003;
  const phiCalc = Math.min(Math.max(0.65 + 0.25 * (et - eyt) / ecmax, 0.65), 0.9);
  // Acero máximo: E.060 10.3.4, E.060 10.3.5, ACI 318-19 18.6.3.1
  const rhob = beta1 * 0.85 * (fc / fy) * (6000 / (6000 + fy));
  const Asmax1034 = 0.75 * rhob * b * d;
  const cmax = (3 * d) / 7;
  const amax = beta1 * cmax;
  const Asmax1035 = (0.85 * fc * amax * b) / fy;
  const rhomax1035 = Asmax1035 / (d * b);
  const ratio1035 = rhomax1035 / rhob;
  const AsmaxACI = 0.025 * b * d;
  const rhomaxACI = AsmaxACI / (d * b);
  const ratioACI = rhomaxACI / rhob;
  const rhoRhob = rho / rhob;
  const Asmax = Math.min(Asmax1034, Asmax1035, AsmaxACI);
  // C. Acero mínimo por flexión
  const Asmin1 = (0.8 * Math.sqrt(fc) / fy) * b * d;
  const Asmin2 = (14 / fy) * b * d;
  const Asmin3 = (4 / 3) * As;
  const Asmin = Math.min(Math.max(Asmin1, Asmin2), Asmin3);
  // D. Acero de temperatura
  const Astem = 0.0018 * b * hv;
  // E. Acero necesario
  const excede = As > Asmax;
  const Ase = excede ? null : Math.max(As, Astem, Asmin);
  // F. Acero a colocar
  const bar = barAcero(p.barra);
  const Av1 = bar.area;
  const Nv = Ase != null ? Ase / Av1 : 0;
  const Ncol = Ase != null ? Math.max(1, Math.ceil(Nv - 1e-9)) : 0;
  return { hv, b, r, phi0, fc, fy, Es, Mu, d, a, As, rho, beta1, c, ecmax, et, eyt, esmin, phiCalc,
    rhob, Asmax1034, cmax, amax, Asmax1035, rhomax1035, ratio1035, AsmaxACI, rhomaxACI, ratioACI,
    rhoRhob, Asmax, Asmin1, Asmin2, Asmin3, Asmin, Astem, excede, Ase, Av1, Nv, Ncol,
    barra: bar.label };
}

// Documento LaTeX standalone de la memoria de DISEÑO DE FLEXIÓN DE VIGAS (ACI 318-19).
function buildMemoriaFlexion(p, proyecto = '', { encabezadoIzq = '', encabezadoDer = '' } = {}) {
  const d = calcFlexion(p);
  const f2 = x => (Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100).toFixed(2), f4 = x => x.toFixed(4);
  const fm = x => Number.isInteger(x) ? String(x) : x.toFixed(2);
  const pp = x => String(Math.round(x * 100 * 100) / 100);
  const titulo = 'DISEÑO DE FLEXIÓN DE VIGAS SEGÚN ACI 318-19';
  const esc = s => (s || '').replace(/[\\{}$&#%_^~]/g, '');
  const U = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{cm}}';
  const U2 = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{cm^{2}}}';
  const UK = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{\\tfrac{kgf}{cm^{2}}}}';
  const UKC = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{kgf\\cdot cm}}';
  const datos = [
    `h_v &:= ${fm(d.hv)}${U} & &\\text{Altura de viga}`,
    `b &:= ${fm(d.b)}${U} & &\\text{Ancho de viga}`,
    `r &:= ${fm(d.r)}${U} & &\\text{Recubrimiento de la viga}`,
    `d &:= h_v - r = ${fm(d.d)}${U} & &\\text{Canto útil de la viga}`,
    `\\phi &:= ${f2(d.phi0)} & &\\text{Factor de reducción por flexión}`,
    `f'_c &:= ${fm(d.fc)}${UK} & &\\text{Resistencia del concreto}`,
    `f_y &:= ${fm(d.fy)}${UK} & &\\text{Fluencia del acero}`,
    `E_s &:= ${fm(d.Es)}${UK} & &\\text{Módulo de elasticidad del acero}`,
    `M_u &:= ${f2(d.Mu)}${UKC} & &\\text{Momento flector amplificado}`,
  ];
  const eAse = d.excede
    ? `A_{se} := \\text{"Cambiar dimensión"}`
    : `A_{se} := \\max(A_s,\\,A_{stem},\\,A_{smin}) = ${f2(d.Ase)}${U2}`;
  const latex = `% Memoria de calculo generada por ETABS API + IA
\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{xcolor}
\\usepackage{array}
\\usepackage[spanish]{babel}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\setlength{\\parindent}{0pt}
\\pagestyle{fancy}\\fancyhf{}
\\lhead{\\textbf{${esc(encabezadoIzq)}}}
\\rhead{${esc(encabezadoDer)}}
\\cfoot{P\\'agina \\thepage\\ de \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.6pt}
\\begin{document}
\\begin{center}
{\\large\\textbf{${titulo}}}\\\\[2pt]
\\textbf{Proyecto: ${esc(proyecto) || '---'}}
\\end{center}
\\vspace{6pt}
\\begin{align*}
${datos.join(' \\\\[3pt]\n')}
\\end{align*}
\\textbf{A. C\\'alculo de refuerzo}
\\[ a := d - \\sqrt{d^{2} - \\dfrac{2\\,M_u}{0.85\\,f'_c\\,\\phi\\,b}} = ${f2(d.a)}${U} \\]
\\[ A_s := \\dfrac{0.85\\,f'_c\\,a\\,b}{f_y} = ${f2(d.As)}${U2} \\qquad \\rho := \\dfrac{A_s}{d\\,b} = ${f4(d.rho)} \\]
\\textbf{B. Verificaci\\'on del acero m\\'aximo}
\\[ \\beta_1 := \\min\\!\\Big(\\max\\big(0.85 - (f'_c-280)\\tfrac{0.05}{70},\\,0.65\\big),\\,0.85\\Big) = ${f2(d.beta1)} \\quad\\text{(ACI 22.2.2.4.3)} \\]
\\[ c := \\dfrac{a}{\\beta_1} = ${f2(d.c)}${U} \\qquad \\varepsilon_t := \\dfrac{d-c}{c}\\,(0.003) = ${f4(d.et)} \\]
\\[ \\varepsilon_{yt} := \\dfrac{f_y}{E_s} = ${f4(d.eyt)} \\qquad \\varepsilon_{s,min} := \\varepsilon_{yt} + 0.003 = ${f4(d.esmin)} \\]
\\[ \\phi := \\min\\!\\Big(\\max\\big(0.65 + 0.25\\tfrac{\\varepsilon_t-\\varepsilon_{yt}}{0.003},\\,0.65\\big),\\,0.9\\Big) = ${f2(d.phiCalc)} \\quad\\text{(ACI R21.2.2)} \\]
\\textbf{Acero m\\'aximo (E.060 10.3.4):}
\\[ \\rho_b := \\beta_1\\,0.85\\dfrac{f'_c}{f_y}\\dfrac{6000}{6000+f_y} = ${f4(d.rhob)} \\qquad A_{smax} := 0.75\\,\\rho_b\\,b\\,d = ${f2(d.Asmax1034)}${U2} \\]
\\textbf{Acero m\\'aximo (E.060 10.3.5):}
\\[ c_{max} := \\tfrac{3}{7}d = ${fm(d.cmax)}${U} \\quad a_{max} := \\beta_1 c_{max} = ${f2(d.amax)}${U} \\quad A_{smax} := \\dfrac{0.85 f'_c a_{max} b}{f_y} = ${f2(d.Asmax1035)}${U2} \\]
\\[ \\rho_{max} := \\dfrac{A_{smax}}{d\\,b} = ${f4(d.rhomax1035)} \\qquad \\dfrac{\\rho_{max}}{\\rho_b} = ${f4(d.ratio1035)} \\]
\\textbf{Acero m\\'aximo (ACI 318-19 18.6.3.1):}
\\[ A_{smax} := 0.025\\,b\\,d = ${f2(d.AsmaxACI)}${U2} \\quad \\rho_{max} := \\dfrac{A_{smax}}{d\\,b} = ${f4(d.rhomaxACI)} \\quad \\dfrac{\\rho_{max}}{\\rho_b} = ${f4(d.ratioACI)} \\]
\\begin{center}
\\begin{tabular}{|c|c|c|}
\\hline
\\textbf{E.060 10.3.4} & \\textbf{E.060 10.3.5} & \\textbf{ACI 18.6.3.1}\\\\
\\hline
${pp(0.75)}\\% \\rho_b & ${pp(d.ratio1035)}\\% \\rho_b & ${pp(d.ratioACI)}\\% \\rho_b\\\\
\\hline
\\end{tabular}
\\end{center}
\\[ \\dfrac{\\rho}{\\rho_b} = ${f2(d.rhoRhob)} \\quad\\text{(porcentaje de la cuant\\'ia balanceada del acero colocado)} \\]
\\textbf{C. Verificaci\\'on del acero m\\'inimo por flexi\\'on}
\\[ A_{smin} := \\min\\!\\Big(\\max\\big(\\tfrac{0.8\\sqrt{f'_c}}{f_y}b\\,d,\\,\\tfrac{14}{f_y}b\\,d\\big),\\,\\tfrac{4}{3}A_s\\Big) = ${f2(d.Asmin)}${U2} \\quad\\text{(ACI 9.6.1)} \\]
\\textbf{D. Verificaci\\'on del acero de temperatura}
\\[ A_{stem} := 0.0018\\,b\\,h_v = ${f2(d.Astem)}${U2} \\quad\\text{(ACI 24.4.3.2)} \\]
\\textbf{E. Acero necesario}
\\[ ${eAse} \\]
\\textbf{F. Acero a colocar}
\\[ A_{v1} := ${f2(d.Av1)}${U2}\\ (\\varnothing\\,${esc(d.barra)}) \\qquad N_v := \\dfrac{A_{se}}{A_{v1}} = ${f2(d.Nv)} \\]
\\begin{center}\\textbf{Empleamos ${d.Ncol}\\ $\\varnothing$\\ ${esc(d.barra)}}\\end{center}
\\end{document}
`;
  return { titulo, latex };
}

// Bloque de esfuerzos a flexión (sección + bloque equivalente 0.85f'c + fuerzas).
function SvgFlexionBloque({ width = 440 }) {
  const C = _COL, H = 200;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      {/* Seccion */}
      <rect x="28" y="38" width="74" height="120" fill={C.concreto} stroke={C.borde} strokeWidth="1.2" />
      {[0, 1, 2].map(i => <circle key={i} cx={47 + i * 18} cy="146" r="4.5" fill={C.barra} />)}
      <line x1="20" y1="74" x2={width - 10} y2="74" stroke={C.borde} strokeWidth="0.6" strokeDasharray="4 3" />
      {/* Esfuerzo real f'c (parabola) */}
      <text x="185" y="32" fontSize="9.5" fill={C.txt} textAnchor="middle">f'c (real)</text>
      <path d="M170 74 C 188 60, 198 50, 215 47 L215 74 Z" fill="#dbe7fb" stroke={C.barra} strokeWidth="1" />
      <line x1="215" y1="47" x2="215" y2="158" stroke={C.borde} strokeWidth="0.5" />
      <g><line x1="230" y1="47" x2="230" y2="74" stroke={C.cota} strokeWidth="0.8" />{_flecha(230, 47, 'up')}{_flecha(230, 74, 'down')}<text x="234" y="63" fontSize="10" fill={C.txt}>c</text></g>
      {/* Bloque equivalente 0.85 f'c */}
      <text x="345" y="32" fontSize="9.5" fill={C.txt} textAnchor="middle">0.85 f'c</text>
      <rect x="300" y="47" width="56" height="27" fill="#dbe7fb" stroke={C.barra} strokeWidth="1" />
      {[0, 1, 2].map(i => <g key={i}><line x1="356" y1={53 + i * 8} x2="372" y2={53 + i * 8} stroke={C.barra} strokeWidth="0.9" />{_flecha(372, 53 + i * 8, 'right')}</g>)}
      <g><line x1="378" y1="47" x2="378" y2="74" stroke={C.cota} strokeWidth="0.8" />{_flecha(378, 47, 'up')}{_flecha(378, 74, 'down')}<text x="382" y="63" fontSize="9" fill={C.txt}>a = β₁c</text></g>
      {/* Traccion T = As fy */}
      <g><line x1="300" y1="146" x2="368" y2="146" stroke={C.barra} strokeWidth="1.3" />{_flecha(372, 146, 'right')}<text x="300" y="140" fontSize="10" fill={C.txt}>T = As·fy</text></g>
    </svg>
  );
}

// Diagrama de deformaciones unitarias (0.003 arriba, c, d-c, et abajo).
function SvgDeformaciones({ width = 320, etLabel = 'εt' }) {
  const C = _COL, H = 180, xs = 70, top = 28, na = 66, bot = 150;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      <line x1={xs} y1={top} x2={xs} y2={bot} stroke={C.borde} strokeWidth="1.3" />
      {/* perfil de deformaciones */}
      <line x1={xs} y1={top} x2={xs + 86} y2={top} stroke={C.barra} strokeWidth="1" />
      <line x1={xs + 86} y1={top} x2={xs} y2={na} stroke={C.barra} strokeWidth="1.4" />
      <line x1={xs} y1={na} x2={xs - 64} y2={bot} stroke={C.barra} strokeWidth="1.4" />
      <line x1={xs} y1={bot} x2={xs - 64} y2={bot} stroke={C.barra} strokeWidth="0.9" />
      <line x1={xs - 64} y1={na} x2={xs - 64} y2={bot} stroke={C.barra} strokeWidth="0.6" strokeDasharray="2 2" />
      <text x={xs + 90} y={top + 4} fontSize="10" fill={C.txt}>0.003</text>
      <g><line x1={xs + 118} y1={top} x2={xs + 118} y2={na} stroke={C.cota} strokeWidth="0.8" />{_flecha(xs + 118, top, 'up')}{_flecha(xs + 118, na, 'down')}<text x={xs + 122} y={(top + na) / 2 + 3} fontSize="10" fill={C.txt}>c</text></g>
      <g><line x1={xs + 118} y1={na} x2={xs + 118} y2={bot} stroke={C.cota} strokeWidth="0.8" />{_flecha(xs + 118, na, 'up')}{_flecha(xs + 118, bot, 'down')}<text x={xs + 122} y={(na + bot) / 2} fontSize="10" fill={C.txt}>d − c</text></g>
      <text x={xs - 68} y={bot + 13} fontSize="10" fill={C.txt} textAnchor="end">{etLabel}</text>
    </svg>
  );
}

// Variación de φ con la deformación unitaria neta a tracción (Fig. R21.2.2b ACI).
function SvgPhiEt({ width = 360 }) {
  const C = _COL, H = 205;
  const x0 = 46, x1 = width - 12, yb = 168;
  const y065 = 148, y075 = 112, y090 = 52;
  const xA = x0 + 95, xB = x0 + 175;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      <line x1={x0} y1="22" x2={x0} y2={yb} stroke={C.txt} strokeWidth="0.9" />
      <line x1={x0} y1={yb} x2={x1} y2={yb} stroke={C.txt} strokeWidth="0.9" />
      <text x={x0 - 6} y="26" fontSize="10" fill={C.txt} textAnchor="end">φ</text>
      {[['0.90', y090], ['0.75', y075], ['0.65', y065]].map(([t, y]) => (
        <g key={t}><line x1={x0 - 3} y1={y} x2={x0} y2={y} stroke={C.txt} strokeWidth="0.6" /><text x={x0 - 5} y={y + 3} fontSize="8" fill={C.txt} textAnchor="end">{t}</text></g>
      ))}
      <path d={`M${x0} ${y065} L${xA} ${y065} L${xB} ${y090} L${x1} ${y090}`} fill="none" stroke={C.cota} strokeWidth="1.7" />
      <path d={`M${x0} ${y075} L${xA} ${y075} L${xB} ${y090} L${x1} ${y090}`} fill="none" stroke={C.barra} strokeWidth="1.2" strokeDasharray="5 3" />
      <line x1={xA} y1="22" x2={xA} y2={yb} stroke={C.borde} strokeWidth="0.5" strokeDasharray="3 2" />
      <line x1={xB} y1="22" x2={xB} y2={yb} stroke={C.borde} strokeWidth="0.5" strokeDasharray="3 2" />
      <text x={x0 + 36} y={y065 - 6} fontSize="7.5" fill={C.cota}>Otros</text>
      <text x={x0 + 50} y={y075 - 6} fontSize="7.5" fill={C.barra}>Espiral</text>
      <text x={(x0 + xA) / 2} y={y065 + 14} fontSize="7" fill={C.txt} textAnchor="middle">Compresión</text>
      <text x={(xA + xB) / 2} y="34" fontSize="7" fill={C.txt} textAnchor="middle">Transición</text>
      <text x={(xB + x1) / 2} y={y090 - 6} fontSize="7" fill={C.txt} textAnchor="middle">Tracción</text>
      <text x={xA} y={yb + 12} fontSize="7" fill={C.txt} textAnchor="middle">εt = εty</text>
      <text x={xB} y={yb + 12} fontSize="7" fill={C.txt} textAnchor="middle">εty + 0.003</text>
      <text x={x1} y={yb + 12} fontSize="8" fill={C.txt} textAnchor="end">εt</text>
    </svg>
  );
}

// Sección de viga con las varillas a colocar (b x hv, n barras del tipo elegido).
function SvgSeccionVigaBarras({ b, hv, n, barra, width = 200 }) {
  const C = _COL, H = 215, sx = 58, sy = 26, sw = 92, sh = 150;
  const nb = Math.max(1, Math.min(n || 1, 8));
  const yb = sy + sh - 16;
  const bars = Array.from({ length: nb }, (_, i) => nb > 1 ? sx + 16 + i * (sw - 32) / (nb - 1) : sx + sw / 2);
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      <rect x={sx} y={sy} width={sw} height={sh} fill={C.concreto} stroke={C.borde} strokeWidth="1.4" />
      <rect x={sx + 8} y={sy + 8} width={sw - 16} height={sh - 16} fill="none" stroke={C.borde} strokeWidth="0.8" rx="4" />
      {bars.map((x, i) => <circle key={i} cx={x} cy={yb} r="5" fill={C.barra} />)}
      <g><line x1={sx} y1={sy - 11} x2={sx + sw} y2={sy - 11} stroke={C.cota} strokeWidth="0.8" />{_flecha(sx, sy - 11, 'left')}{_flecha(sx + sw, sy - 11, 'right')}<text x={sx + sw / 2} y={sy - 15} fontSize="10" fill={C.txt} textAnchor="middle">b = {b} cm</text></g>
      <g><line x1={sx + sw + 13} y1={sy} x2={sx + sw + 13} y2={sy + sh} stroke={C.cota} strokeWidth="0.8" />{_flecha(sx + sw + 13, sy, 'up')}{_flecha(sx + sw + 13, sy + sh, 'down')}<text x={sx + sw + 17} y={sy + sh / 2} fontSize="10" fill={C.txt}>h = {hv} cm</text></g>
      <text x={sx + sw / 2} y={sy + sh + 24} fontSize="11" fill={C.barra} textAnchor="middle" fontWeight="bold">{n} ø {barra}</text>
    </svg>
  );
}

// Calcula la DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN (ACI 318-19 18.4.2.2 / E.060 21.4.4.2):
// 6 momentos de diseño (M1,M2 caras (−); M3 centro (+); M4=M1/3, M5=M2/3 mínimos (+) en caras;
// M6=máx(M1,M2)/5 mínimo en cualquier sección) y el As requerido en cada uno.
function calcDistribucion(p) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const b = num(p.b, 40), d = num(p.d, 64), fc = num(p.fc, 280), fy = num(p.fy, 4200), phi = num(p.phi, 0.9);
  const M1 = num(p.M1, 0), M2 = num(p.M2, 0), M3 = num(p.M3, 0);
  const M4 = M1 / 3, M5 = M2 / 3, M6 = Math.max(M1, M2) / 5;
  const AsminBase = Math.max((0.8 * Math.sqrt(fc) / fy) * b * d, (14 / fy) * b * d);
  const fila = (tag, M, pos) => {
    const disc = d * d - (2 * M) / (0.85 * fc * phi * b);
    const a = d - Math.sqrt(Math.max(disc, 0));
    const Asres = (0.85 * fc * a * b) / fy;
    const Asmin = Math.min(AsminBase, (4 / 3) * Asres);
    const As = Math.max(Asres, Asmin);
    return { tag, M, pos, a, Asmin, Asres, As };
  };
  const filas = [
    fila('M₁', M1, 'Cara izquierda (−)'),
    fila('M₂', M2, 'Cara derecha (−)'),
    fila('M₃', M3, 'Centro de luz (+)'),
    fila('M₄', M4, 'Izquierda (+) = M₁/3'),
    fila('M₅', M5, 'Derecha (+) = M₂/3'),
    fila('M₆', M6, 'Cualquier sección = máx/5'),
  ];
  return { b, d, fc, fy, phi, M1, M2, M3, M4, M5, M6, AsminBase, filas };
}

// Documento LaTeX de la memoria de DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN.
function buildMemoriaDistribucion(p, proyecto = '', { encabezadoIzq = '', encabezadoDer = '' } = {}) {
  const D = calcDistribucion(p);
  const f2 = x => (Math.round(x * 100 + 1e-6) / 100).toFixed(2);
  const titulo = 'DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN SEGÚN ACI 318-19';
  const esc = s => (s || '').replace(/[\\{}$&#%_^~]/g, '');
  const U2 = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{cm^{2}}}';
  const UKC = '\\;\\textcolor[HTML]{1D4ED8}{\\mathbf{kgf\\!\\cdot\\!cm}}';
  const tags = ['M_1', 'M_2', 'M_3', 'M_4', 'M_5', 'M_6'];
  const filaT = (f, i) => `${tags[i]} & ${D.b} & ${D.d} & ${D.fc} & ${D.fy} & ${D.phi} & ${f2(f.M)} & ${f2(f.a)} & ${f2(f.Asmin)} & ${f2(f.Asres)} & \\textbf{${f2(f.As)}} \\\\`;
  const latex = `% Memoria de calculo generada por ETABS API + IA
\\documentclass[a4paper,10pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath}
\\usepackage{xcolor}
\\usepackage{array}
\\usepackage[spanish]{babel}
\\usepackage[margin=2cm]{geometry}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\setlength{\\parindent}{0pt}
\\pagestyle{fancy}\\fancyhf{}
\\lhead{\\textbf{${esc(encabezadoIzq)}}}
\\rhead{${esc(encabezadoDer)}}
\\cfoot{P\\'agina \\thepage\\ de \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.6pt}
\\begin{document}
\\begin{center}
{\\large\\textbf{${titulo}}}\\\\[2pt]
\\textbf{ACI 318-19 Art. 18.4.2.2\\ \\textbar\\ E.060 Art. 21.4.4.2}\\\\[2pt]
\\textbf{Proyecto: ${esc(proyecto) || '---'}}
\\end{center}
\\vspace{6pt}
\\textbf{1. Momentos de dise\\~no}
\\begin{align*}
M_1 &:= ${f2(D.M1)}${UKC} & &\\text{Momento negativo, cara izquierda}\\\\[3pt]
M_2 &:= ${f2(D.M2)}${UKC} & &\\text{Momento negativo, cara derecha}\\\\[3pt]
M_3 &:= ${f2(D.M3)}${UKC} & &\\text{Momento positivo, centro de luz}\\\\[3pt]
M_4 &:= \\tfrac{M_1}{3} = ${f2(D.M4)}${UKC} & &\\text{M\\'inimo positivo en cara izquierda}\\\\[3pt]
M_5 &:= \\tfrac{M_2}{3} = ${f2(D.M5)}${UKC} & &\\text{M\\'inimo positivo en cara derecha}\\\\[3pt]
M_6 &:= \\tfrac{\\max(M_1,M_2)}{5} = ${f2(D.M6)}${UKC} & &\\text{M\\'inimo en cualquier secci\\'on}
\\end{align*}
\\textbf{2. Acero requerido en cada secci\\'on}
\\begin{center}
\\begin{tabular}{|c|c|c|c|c|c|r|c|c|c|c|}
\\hline
\\textbf{M} & \\textbf{b} & \\textbf{d} & \\textbf{f'c} & \\textbf{fy} & \\textbf{$\\phi$} & \\textbf{Mu} & \\textbf{a} & \\textbf{As,min} & \\textbf{As,req} & \\textbf{As}\\\\
\\hline
${D.filas.map(filaT).join('\n')}
\\hline
\\end{tabular}
\\end{center}
\\vspace{2pt}
{\\small As (cm$^2$) $= \\max(A_{s,req},\\,A_{s,min})$, con $A_{s,min} = \\min\\!\\big(\\max(\\tfrac{0.8\\sqrt{f'c}}{fy}bd,\\ \\tfrac{14}{fy}bd),\\ \\tfrac{4}{3}A_{s,req}\\big)$.}
\\par\\vspace{8pt}
\\textbf{3. Distribuci\\'on del refuerzo}
\\begin{align*}
A_{s1} &= ${f2(D.filas[0].As)}${U2} & A_{s2} &= ${f2(D.filas[1].As)}${U2} & A_{s3} &= ${f2(D.filas[2].As)}${U2}\\\\[3pt]
A_{s4} &= ${f2(D.filas[3].As)}${U2} & A_{s5} &= ${f2(D.filas[4].As)}${U2} & A_{s6} &= ${f2(D.filas[5].As)}${U2}
\\end{align*}
\\end{document}
`;
  return { titulo, latex };
}

// Envolvente de momentos / distribución de acero a lo largo de la viga (figura del usuario).
function SvgDistribRefuerzo({ datos, modo = 'M', width = 480 }) {
  const C = _COL, H = 188, x0 = 54, x1 = width - 54, xm = (x0 + x1) / 2, ax = 90;
  const maxM = Math.max(datos.M1, datos.M2, datos.M3, 1);
  const sc = 44 / maxM;
  const hL = datos.M1 * sc, hR = datos.M2 * sc, hM = datos.M3 * sc;
  const yEnv = x => {
    const t = (x - x0) / (x1 - x0);
    const lh = t < 0.24 ? Math.cos((t / 0.24) * Math.PI / 2) : 0;
    const rh = t > 0.76 ? Math.cos(((1 - t) / 0.24) * Math.PI / 2) : 0;
    const bl = (t > 0.16 && t < 0.84) ? Math.sin((t - 0.16) / 0.68 * Math.PI) : 0;
    return ax - hL * lh - hR * rh + hM * bl;
  };
  const pts = [];
  for (let x = x0; x <= x1; x += 4) pts.push(`${x.toFixed(1)},${yEnv(x).toFixed(1)}`);
  const hatch = [];
  for (let x = x0 + 5; x < x1; x += 8) hatch.push([x, yEnv(x)]);
  const f2 = v => (Math.round(v * 100 + 1e-6) / 100).toFixed(2);
  const mlab = v => String(Math.round(v));
  const lab = (x, y, t, anchor, col) => <text x={x} y={y} fontSize="8.5" fill={col || C.cota} textAnchor={anchor || 'middle'} fontWeight="bold">{t}</text>;
  const F = datos.filas, qx = (x1 - x0) * 0.2;
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" style={{ background: '#fff', maxWidth: width }}>
      <line x1={x0 - 16} y1={ax} x2={x1 + 16} y2={ax} stroke="#2e7d32" strokeWidth="1.8" />
      <polygon points={`${x0},${ax} ${x0 - 8},${ax + 12} ${x0 + 8},${ax + 12}`} fill="none" stroke="#2e7d32" strokeWidth="1" />
      <polygon points={`${x1},${ax} ${x1 - 8},${ax + 12} ${x1 + 8},${ax + 12}`} fill="none" stroke="#2e7d32" strokeWidth="1" />
      {hatch.map(([x, y], i) => <line key={i} x1={x} y1={ax} x2={x} y2={y} stroke="#9db8e0" strokeWidth="1.1" />)}
      <polyline points={pts.join(' ')} fill="none" stroke={C.barra} strokeWidth="1.5" />
      {modo === 'M' ? (<>
        {lab(x0 - 8, ax - hL - 6, `M₁ = ${mlab(datos.M1)}`, 'start')}
        {lab(x1 + 8, ax - hR - 6, `M₂ = ${mlab(datos.M2)}`, 'end')}
        {lab(xm, ax + hM + 14, `M₃ = ${mlab(datos.M3)}`, 'middle')}
        {lab(xm, 15, `M₆ = ${mlab(datos.M6)}`, 'middle')}
        {lab(x0 + qx, H - 6, `M₄ = ${mlab(datos.M4)}`, 'middle', C.txt)}
        {lab(x1 - qx, H - 6, `M₅ = ${mlab(datos.M5)}`, 'middle', C.txt)}
      </>) : (<>
        {lab(x0 - 8, ax - hL - 6, `As₁ = ${f2(F[0].As)}`, 'start')}
        {lab(x1 + 8, ax - hR - 6, `As₂ = ${f2(F[1].As)}`, 'end')}
        {lab(xm, ax + hM + 14, `As₃ = ${f2(F[2].As)}`, 'middle')}
        {lab(xm, 15, `As₆ = ${f2(F[5].As)}`, 'middle')}
        {lab(x0 + qx, H - 6, `As₄ = ${f2(F[3].As)}`, 'middle', C.txt)}
        {lab(x1 - qx, H - 6, `As₅ = ${f2(F[4].As)}`, 'middle', C.txt)}
      </>)}
    </svg>
  );
}

function getSelectedModelValue(provider, config) {
  const model = provider === 'openai' ? config.openaiModel : provider === 'anthropic' ? config.anthropicModel : config.geminiModel;
  const options = MODEL_OPTIONS_BY_PROVIDER[provider] || GEMINI_MODEL_OPTIONS;
  return options.some(option => option.value === model) ? model : 'custom';
}

function getModelHint(provider, config) {
  const selected = getSelectedModelValue(provider, config);
  const options = MODEL_OPTIONS_BY_PROVIDER[provider] || GEMINI_MODEL_OPTIONS;
  return options.find(option => option.value === selected)?.hint || 'Modelo personalizado.';
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    explanation: { type: 'string' },
    execution_plan: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    needs_user_confirmation: { type: 'boolean' },
    code: { type: 'string' }
  },
  required: ['explanation', 'execution_plan', 'assumptions', 'warnings', 'needs_user_confirmation', 'code']
};

function extractJsonObject(rawText) {
  const text = String(rawText || '').replace(/```json/gi, '').replace(/```python/gi, '').replace(/```/g, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
  return text;
}

// ============================================================
// VISTA PREVIA DETERMINISTA (v2.3.0): dibujos SVG calculados desde
// los parametros de las herramientas, ANTES de enviar nada a ETABS.
// Sin IA y sin servidor: lo que se ve es lo que el script creara.
// ============================================================

function escalaLineal(valores, margen, largo) {
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = (max - min) || 1;
  return v => margen + ((v - min) / span) * (largo - 2 * margen);
}

const ETIQUETAS_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Vista 3D GIRATORIA (orbita con arrastre, zoom con rueda) de la grilla:
// proyeccion ortografica yaw+pitch, sin librerias 3D. ordsX/ordsY en metros,
// niveles = cotas Z (incluida la base). az=acimut, el=elevacion de camara.
function SvgGrilla3D({ ordsX = [], ordsY = [], niveles = [0], width = 1080, height = 380, nivelSelZ = null, ejeSel = null, elementos = [], vistas = false, selId = null, interactivo = false, toolModo = null, planoZ = 0, onWorldClick = null, onDeleteEl = null }) {
  const [rot, setRot] = useState({ az: -32, el: 24 });
  const [zoom, setZoom] = useState(1);
  const drag = useRef(null);
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = e => { e.preventDefault(); setZoom(z => Math.min(5, Math.max(0.4, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const xs = (ordsX && ordsX.length ? [...ordsX] : [0, 5]).sort((a, b) => a - b);
  const ys = (ordsY && ordsY.length ? [...ordsY] : [0, 4]).sort((a, b) => a - b);
  const zs = (niveles && niveles.length ? [...niveles] : [0, 3]).sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-4 text-center">Define al menos 2 ejes en X y en Y para ver la grilla en 3D.</div>;
  }
  const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
  const z0 = zs[0], z1 = zs[zs.length - 1] || (z0 + 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const azR = rot.az * Math.PI / 180, elR = rot.el * Math.PI / 180;
  const cosA = Math.cos(azR), sinA = Math.sin(azR), cosE = Math.cos(elR), sinE = Math.sin(elR);
  // yaw alrededor de Z, luego proyeccion ortografica con elevacion de camara.
  // el=90 -> planta (mira hacia abajo); el=0 -> elevacion (mira de costado).
  const proj = (x, y, z) => {
    const X = x - cx, Y = y - cy, Z = z - cz;
    const X1 = X * cosA - Y * sinA;
    const Y1 = X * sinA + Y * cosA;
    return { sx: X1, sy: Y1 * sinE - Z * cosE };
  };
  const pts = [];
  [x0, x1].forEach(x => [y0, y1].forEach(y => [z0, z1].forEach(z => pts.push(proj(x, y, z)))));
  const minX = Math.min(...pts.map(p => p.sx)), maxX = Math.max(...pts.map(p => p.sx));
  const minY = Math.min(...pts.map(p => p.sy)), maxY = Math.max(...pts.map(p => p.sy));
  const pad = 52;
  const escala = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxY - minY || 1)) * zoom;
  const offX = width / 2 - ((minX + maxX) / 2) * escala;
  const offY = height / 2 - ((minY + maxY) / 2) * escala;
  const P = (x, y, z) => { const o = proj(x, y, z); return [offX + o.sx * escala, offY + o.sy * escala]; };
  const seg = (p1, p2) => `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;

  const grid = [];
  let k = 0;
  zs.forEach((z, zi) => {
    const fuerte = zi === 0 || zi === zs.length - 1;
    const col = fuerte ? '#9ca3af' : '#4b5563';   // grilla en GRIS
    const op = fuerte ? 0.85 : 0.45, w = fuerte ? 1.3 : 1;
    ys.forEach(y => grid.push(<path key={`x${k++}`} d={seg(P(x0, y, z), P(x1, y, z))} stroke={col} strokeWidth={w} opacity={op} fill="none" />));
    xs.forEach(x => grid.push(<path key={`y${k++}`} d={seg(P(x, y0, z), P(x, y1, z))} stroke={col} strokeWidth={w} opacity={op} fill="none" />));
  });
  xs.forEach(x => ys.forEach(y => grid.push(<path key={`v${k++}`} d={seg(P(x, y, z0), P(x, y, z1))} stroke="#6b7280" strokeWidth="1.1" opacity="0.5" fill="none" />)));

  const lab = [];
  xs.forEach((x, i) => { const p = P(x, y0, z0); lab.push(<g key={`bx${i}`}><circle cx={p[0]} cy={p[1] + 15} r="8.5" fill="#0b0e14" stroke="#3b82f6" strokeWidth="1" /><text x={p[0]} y={p[1] + 18} textAnchor="middle" fontSize="8.5" fill="#93c5fd" fontWeight="700">{ETIQUETAS_ABC[i % 26]}</text></g>); });
  ys.forEach((y, j) => { const p = P(x0, y, z0); lab.push(<g key={`by${j}`}><circle cx={p[0] - 15} cy={p[1] + 4} r="8.5" fill="#0b0e14" stroke="#3b82f6" strokeWidth="1" /><text x={p[0] - 15} y={p[1] + 7} textAnchor="middle" fontSize="8.5" fill="#93c5fd" fontWeight="700">{j + 1}</text></g>); });
  zs.forEach((z, i) => { const p = P(x1, y1, z); lab.push(<text key={`bz${i}`} x={p[0] + 9} y={p[1] + 3} fontSize="8" fill={(nivelSelZ != null && Math.abs(z - nivelSelZ) < 1e-6) ? '#fbbf24' : '#94a3b8'} fontWeight="600">{`N${i} +${z.toFixed(2)} m`}</text>); });

  // Resaltado AMBAR del nivel (planta) y del eje (elevacion) seleccionados.
  const hl = [];
  const HL = (p1, p2, key) => hl.push(<path key={key} d={seg(p1, p2)} stroke="#fbbf24" strokeWidth="2.2" opacity="0.95" fill="none" />);
  if (nivelSelZ != null) {
    ys.forEach((y, j) => HL(P(x0, y, nivelSelZ), P(x1, y, nivelSelZ), `hnx${j}`));
    xs.forEach((x, i) => HL(P(x, y0, nivelSelZ), P(x, y1, nivelSelZ), `hny${i}`));
  }
  if (ejeSel && ejeSel.tipo === 'Y') {
    zs.forEach((z, i) => HL(P(x0, ejeSel.val, z), P(x1, ejeSel.val, z), `heh${i}`));
    xs.forEach((x, i) => HL(P(x, ejeSel.val, z0), P(x, ejeSel.val, z1), `hev${i}`));
  } else if (ejeSel && ejeSel.tipo === 'X') {
    zs.forEach((z, i) => HL(P(ejeSel.val, y0, z), P(ejeSel.val, y1, z), `heh${i}`));
    ys.forEach((y, i) => HL(P(ejeSel.val, y, z0), P(ejeSel.val, y, z1), `hev${i}`));
  }

  // Elementos dibujados (Modelador): paneles (losa/muro) detras, lineas
  // (viga/columna) delante, usando la MISMA proyeccion P (rotan con la vista).
  const elems = [];
  let ek = 0;
  const poly = (puntos, color, key, fillOp = 0.22) => <polygon key={key} points={puntos.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill={color} fillOpacity={fillOp} stroke={color} strokeOpacity="0.85" strokeWidth="1.3" />;
  (elementos || []).filter(e => e.tipo === 'losa' || e.tipo === 'muro').forEach(el => {
    const c = colorDeSeccion(el.sec);
    if (el.tipo === 'losa') elems.push(poly(losaPts(el).map(q => P(q.x, q.y, el.z)), c, `el${ek++}`, 0.22));
    else elems.push(poly([P(el.x1, el.y1, el.zBot), P(el.x2, el.y2, el.zBot), P(el.x2, el.y2, el.zTop), P(el.x1, el.y1, el.zTop)], c, `el${ek++}`, 0.32));
  });
  (elementos || []).filter(e => e.tipo === 'viga' || e.tipo === 'columna').forEach(el => {
    const c = colorDeSeccion(el.sec);
    if (el.tipo === 'columna') elems.push(<path key={`el${ek++}`} d={seg(P(el.x, el.y, el.zBot), P(el.x, el.y, el.zTop))} stroke={c} strokeWidth="3.2" opacity="0.95" fill="none" strokeLinecap="round" />);
    else elems.push(<path key={`el${ek++}`} d={seg(P(el.x1, el.y1, el.z), P(el.x2, el.y2, el.z))} stroke={c} strokeWidth="3.2" opacity="0.95" fill="none" strokeLinecap="round" />);
  });
  if (selId != null) {
    const el = (elementos || []).find(e => e.id === selId);
    if (el) {
      if (el.tipo === 'columna') elems.push(<path key={`sel${ek++}`} d={seg(P(el.x, el.y, el.zBot), P(el.x, el.y, el.zTop))} stroke="#fbbf24" strokeWidth="4.6" fill="none" strokeLinecap="round" />);
      else if (el.tipo === 'viga') elems.push(<path key={`sel${ek++}`} d={seg(P(el.x1, el.y1, el.z), P(el.x2, el.y2, el.z))} stroke="#fbbf24" strokeWidth="4.6" fill="none" strokeLinecap="round" />);
      else if (el.tipo === 'muro') elems.push(poly([P(el.x1, el.y1, el.zBot), P(el.x2, el.y2, el.zBot), P(el.x2, el.y2, el.zTop), P(el.x1, el.y1, el.zTop)], '#fbbf24', `sel${ek++}`, 0.3));
      else elems.push(poly(losaPts(el).map(q => P(q.x, q.y, el.z)), '#fbbf24', `sel${ek++}`, 0.25));
    }
  }

  const vistasPreset = vistas ? [['Planta', 0, 89], ['Frente', 0, 2], ['Lado', -90, 2], ['Iso', -32, 24]] : [];
  // Inverso de P para un Z dado (clic en pantalla -> punto del mundo en el plano).
  const inversoEnPlano = (Sx, Sy, z) => {
    if (Math.abs(sinE) < 0.1) return null; // casi de costado: ambiguo (inclina la vista)
    const X1 = (Sx - offX) / escala;
    const Y1 = ((Sy - offY) / escala + (z - cz) * cosE) / sinE;
    return { x: cx + X1 * cosA + Y1 * sinA, y: cy - X1 * sinA + Y1 * cosA };
  };
  const distSegPix = (p1, p2, px, py) => { const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = dx * dx + dy * dy || 1; let t = ((px - p1[0]) * dx + (py - p1[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); return (p1[0] + t * dx - px) ** 2 + (p1[1] + t * dy - py) ** 2; };
  const elemEnPantalla = (Sx, Sy) => {
    let best = null, bd = 18 * 18;
    (elementos || []).forEach(el => {
      let dd;
      if (el.tipo === 'columna') { const p = P(el.x, el.y, (el.zBot + el.zTop) / 2); dd = (p[0] - Sx) ** 2 + (p[1] - Sy) ** 2; }
      else if (el.tipo === 'viga') dd = distSegPix(P(el.x1, el.y1, el.z), P(el.x2, el.y2, el.z), Sx, Sy);
      else if (el.tipo === 'muro') { const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2; dd = distSegPix(P(mx, my, el.zBot), P(mx, my, el.zTop), Sx, Sy); }
      else { const ps = losaPts(el).map(q => P(q.x, q.y, el.z)); const cx2 = ps.reduce((a, p) => a + p[0], 0) / ps.length, cy2 = ps.reduce((a, p) => a + p[1], 0) / ps.length; dd = (cx2 - Sx) ** 2 + (cy2 - Sy) ** 2; }
      if (dd < bd) { bd = dd; best = el.id; }
    });
    return best;
  };
  const onDown = e => { drag.current = { x: e.clientX, y: e.clientY, az: rot.az, el: rot.el, moved: false }; };
  const onMove = e => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setRot({ az: drag.current.az + dx * 0.5, el: Math.max(2, Math.min(88, drag.current.el - dy * 0.5)) });
  };
  const onUp = e => {
    const dr = drag.current; drag.current = null;
    if (!dr || dr.moved || !interactivo || !toolModo) return; // fue rotacion o no hay herramienta
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const Sx = (e.clientX - rect.left) * (width / rect.width), Sy = (e.clientY - rect.top) * (height / rect.height);
    if (toolModo === 'borrar') { const id = elemEnPantalla(Sx, Sy); if (id != null && onDeleteEl) onDeleteEl(id); return; }
    const w = inversoEnPlano(Sx, Sy, planoZ); if (!w) return;
    let bx = w.x, by = w.y, bd = Infinity;
    xs.forEach(gx => ys.forEach(gy => { const d = (gx - w.x) ** 2 + (gy - w.y) ** 2; if (d < bd) { bd = d; bx = gx; by = gy; } }));
    if (onWorldClick) onWorldClick(bx, by);
  };

  return (
    <div ref={wrapRef} className="relative" style={{ cursor: (interactivo && toolModo) ? (toolModo === 'borrar' ? 'pointer' : 'crosshair') : 'grab', touchAction: 'none', userSelect: 'none' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
      onDoubleClick={() => { setRot({ az: -32, el: 24 }); setZoom(1); }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
        {grid}
        {hl}
        {elems}
        {lab}
      </svg>
      {interactivo && toolModo && Math.abs(sinE) < 0.1 && toolModo !== 'borrar' && <div className="absolute top-2 right-2 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[8px] font-bold px-2 py-0.5 rounded">Inclina la vista para dibujar en 3D</div>}
      <div className="absolute bottom-1 right-2 text-[8px] text-slate-600 pointer-events-none">arrastra para girar · rueda zoom · doble clic reinicia</div>
      {vistasPreset.length > 0 && (
        <div className="absolute top-2 left-2 flex gap-1">
          {vistasPreset.map(([lbl, az, el]) => (
            <button key={lbl} onClick={ev => { ev.stopPropagation(); setRot({ az, el }); }} onMouseDown={ev => ev.stopPropagation()}
              className="px-2 py-0.5 rounded bg-black/50 hover:bg-cyan-600/30 border border-white/10 text-cyan-200 text-[8px] font-black uppercase">{lbl}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Envoltorio PAN (arrastrar) + ZOOM (rueda) estilo ETABS para una vista SVG.
// Aplica translate+scale por CSS; doble clic reinicia.
function VistaInteractiva({ children }) {
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef(null);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = e => { e.preventDefault(); setT(p => ({ ...p, k: Math.min(6, Math.max(0.35, p.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) })); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const onDown = e => { drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }; };
  const onMove = e => { if (!drag.current) return; setT(p => ({ ...p, x: drag.current.tx + (e.clientX - drag.current.x), y: drag.current.ty + (e.clientY - drag.current.y) })); };
  const onUp = () => { drag.current = null; };
  return (
    <div ref={ref} className="relative overflow-hidden rounded-lg" style={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onDoubleClick={() => setT({ x: 0, y: 0, k: 1 })}>
      <div style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, transformOrigin: 'center center' }}>
        {children}
      </div>
      <div className="absolute bottom-1 right-2 text-[8px] text-slate-600 pointer-events-none">arrastra · rueda zoom · doble clic reinicia</div>
    </div>
  );
}

// Planta: grilla con ejes, paños de losa, porticos y cargas de losa.

function SvgPlanta({ ordsX, ordsY, width = 340, conPorticos = false, conLosa = false, etiquetaLosa = '', etiquetaCarga = '', resaltarX = -1, resaltarY = -1, ejes = [] }) {
  if (!ordsX || ordsX.length < 2 || !ordsY || ordsY.length < 2) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-3">Define al menos 2 ejes en X y en Y para ver la planta.</div>;
  }
  // Dominio = ejes ortogonales + extremos de los ejes inclinados (para que no se recorten).
  const domX = [...ordsX, ...ejes.flatMap(e => [e.x1, e.x2])];
  const domY = [...ordsY, ...ejes.flatMap(e => [e.y1, e.y2])];
  const spanX = Math.max(...domX) - Math.min(...domX) || 1;
  const spanY = Math.max(...domY) - Math.min(...domY) || 1;
  const height = Math.max(150, Math.min(380, Math.round((width - 70) * spanY / spanX) + 70));
  const M = 34;
  const sx = escalaLineal(domX, M, width);
  const syc = escalaLineal(domY, M, height);
  const sy = v => height - syc(v);
  const x0 = sx(ordsX[0]), x1 = sx(ordsX[ordsX.length - 1]);
  const y0 = sy(ordsY[0]), y1 = sy(ordsY[ordsY.length - 1]);
  // Ejes ortogonales que COINCIDEN con un eje inclinado: se ocultan (los reemplaza el inclinado).
  // Planta trapezoidal: los bordes 1/5 pasan a inclinados (EI) y los verticales A,B,C a 2 puntos,
  // así que sus líneas rectas no deben dibujarse encima.
  const tolCo = 0.05 * Math.max(spanX, spanY);
  const inclV = ejes.filter(e => Math.abs(Number(e.x2) - Number(e.x1)) <= Math.abs(Number(e.y2) - Number(e.y1)));
  const inclH = ejes.filter(e => Math.abs(Number(e.x2) - Number(e.x1)) > Math.abs(Number(e.y2) - Number(e.y1)));
  const hideX = i => inclV.some(e => Math.abs((Number(e.x1) + Number(e.x2)) / 2 - ordsX[i]) <= tolCo);
  const hideY = j => inclH.some(e => Math.abs((Number(e.y1) + Number(e.y2)) / 2 - ordsY[j]) <= tolCo);
  return (
    <svg width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
      {conLosa && ordsX.slice(0, -1).map((xa, i) => ordsY.slice(0, -1).map((ya, j) => (
        <rect key={`l${i}-${j}`} x={sx(xa)} y={sy(ordsY[j + 1])} width={sx(ordsX[i + 1]) - sx(xa)} height={sy(ya) - sy(ordsY[j + 1])}
          fill="rgba(59,130,246,0.10)" stroke="rgba(59,130,246,0.25)" strokeWidth="1" />
      )))}
      {ordsX.map((x, i) => hideX(i) ? null : (
        <g key={`gx${i}`}>
          <line x1={sx(x)} y1={y1} x2={sx(x)} y2={y0} stroke={i === resaltarX ? '#fbbf24' : 'rgba(148,163,184,0.45)'} strokeWidth={i === resaltarX ? 2.5 : 1} strokeDasharray={i === resaltarX ? '0' : '5 4'} opacity={i === resaltarX ? 0.9 : 1} />
          <circle cx={sx(x)} cy={y1 - 13} r="9" fill={i === resaltarX ? '#fbbf24' : 'none'} stroke={i === resaltarX ? '#fbbf24' : 'rgba(59,130,246,0.6)'} strokeWidth="1" />
          <text x={sx(x)} y={y1 - 10} textAnchor="middle" fontSize="8" fill={i === resaltarX ? '#0b0e14' : '#93c5fd'} fontWeight="700">{i + 1}</text>
        </g>
      ))}
      {ordsY.map((y, j) => hideY(j) ? null : (
        <g key={`gy${j}`}>
          <line x1={x0} y1={sy(y)} x2={x1} y2={sy(y)} stroke={j === resaltarY ? '#fbbf24' : 'rgba(148,163,184,0.45)'} strokeWidth={j === resaltarY ? 2.5 : 1} strokeDasharray={j === resaltarY ? '0' : '5 4'} opacity={j === resaltarY ? 0.9 : 1} />
          <circle cx={x0 - 14} cy={sy(y)} r="9" fill={j === resaltarY ? '#fbbf24' : 'none'} stroke={j === resaltarY ? '#fbbf24' : 'rgba(59,130,246,0.6)'} strokeWidth="1" />
          <text x={x0 - 14} y={sy(y) + 3} textAnchor="middle" fontSize="8" fill={j === resaltarY ? '#0b0e14' : '#93c5fd'} fontWeight="700">{ETIQUETAS_ABC[j % 26]}</text>
        </g>
      ))}
      {conPorticos && ordsY.map((y, j) => ordsX.slice(0, -1).map((xa, i) => (
        <line key={`bx${i}-${j}`} x1={sx(xa)} y1={sy(y)} x2={sx(ordsX[i + 1])} y2={sy(y)} stroke="rgba(52,211,153,0.8)" strokeWidth="2.5" />
      )))}
      {conPorticos && ordsX.map((x, i) => ordsY.slice(0, -1).map((ya, j) => (
        <line key={`by${i}-${j}`} x1={sx(x)} y1={sy(ya)} x2={sx(x)} y2={sy(ordsY[j + 1])} stroke="rgba(52,211,153,0.8)" strokeWidth="2.5" />
      )))}
      {conPorticos && ordsX.map((x, i) => ordsY.map((y, j) => (
        <rect key={`c${i}-${j}`} x={sx(x) - 3.5} y={sy(y) - 3.5} width="7" height="7" fill="#e2e8f0" stroke="#0d1017" strokeWidth="1" />
      )))}
      {ordsX.slice(0, -1).map((xa, i) => (
        <text key={`dx${i}`} x={(sx(xa) + sx(ordsX[i + 1])) / 2} y={y0 + 14} textAnchor="middle" fontSize="8" fill="#64748b">{(ordsX[i + 1] - xa).toFixed(2).replace(/\.?0+$/, '')} m</text>
      ))}
      {ordsY.slice(0, -1).map((ya, j) => (
        <text key={`dy${j}`} x={x1 + 6} y={(sy(ya) + sy(ordsY[j + 1])) / 2 + 3} fontSize="8" fill="#64748b">{(ordsY[j + 1] - ya).toFixed(2).replace(/\.?0+$/, '')}</text>
      ))}
      {conLosa && etiquetaLosa && <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 - 6} textAnchor="middle" fontSize="9" fill="#a5f3fc" fontWeight="700">{etiquetaLosa}</text>}
      {etiquetaCarga && <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 + 8} textAnchor="middle" fontSize="9" fill="#fca5a5" fontWeight="700">{etiquetaCarga}</text>}
      {/* EJES INCLINADOS (General Cartesian): linea ambar continua + burbuja con su ID. */}
      {ejes.map((e, i) => {
        const bx = e.bubble === 'End' ? sx(e.x2) : sx(e.x1);
        const by = e.bubble === 'End' ? sy(e.y2) : sy(e.y1);
        return (
          <g key={`ei${i}`}>
            <line x1={sx(e.x1)} y1={sy(e.y1)} x2={sx(e.x2)} y2={sy(e.y2)} stroke="#fbbf24" strokeWidth="2" />
            <circle cx={sx(e.x1)} cy={sy(e.y1)} r="2.5" fill="#fbbf24" />
            <circle cx={sx(e.x2)} cy={sy(e.y2)} r="2.5" fill="#fbbf24" />
            <circle cx={bx} cy={by} r="9" fill="#0b0e14" stroke="#fbbf24" strokeWidth="1.2" />
            <text x={bx} y={by + 3} textAnchor="middle" fontSize="7.5" fill="#fbbf24" fontWeight="700">{e.id}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Elevacion: pisos, columnas, vigas, apoyos y carga distribuida en vigas.
// etiquetaEjes: 'num' (1,2,3 = ejes en X) o 'abc' (A,B,C = ejes en Y).
function SvgElevacion({ niveles, ords, width = 340, conPorticos = true, conApoyos = false, empotrado = true, etiquetaCargaViga = '', etiquetaEjes = 'num' }) {
  if (!niveles || niveles.length < 2 || !ords || ords.length < 2) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-3">Define la grilla y los pisos para ver la elevacion.</div>;
  }
  const spanX = Math.max(...ords) - Math.min(...ords) || 1;
  const spanZ = Math.max(...niveles) - Math.min(...niveles) || 1;
  const height = Math.max(150, Math.min(400, Math.round((width - 70) * spanZ / spanX) + 70));
  const M = 34;
  const sx = escalaLineal(ords, M, width);
  const szc = escalaLineal(niveles, M, height);
  const sz = v => height - szc(v);
  const base = niveles[0];
  const tope = niveles[niveles.length - 1];
  return (
    <svg width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
      <line x1={sx(ords[0]) - 16} y1={sz(base)} x2={sx(ords[ords.length - 1]) + 16} y2={sz(base)} stroke="rgba(148,163,184,0.7)" strokeWidth="2" />
      {/* Lineas de nivel de piso (siempre, como en ETABS) */}
      {niveles.map((z, k) => (
        <line key={`lv${k}`} x1={sx(ords[0])} y1={sz(z)} x2={sx(ords[ords.length - 1])} y2={sz(z)} stroke="rgba(148,163,184,0.22)" strokeWidth="1" strokeDasharray="4 4" />
      ))}
      {/* EJES de grilla verticales + burbujas (siempre) */}
      {ords.map((x, i) => (
        <g key={`ax${i}`}>
          <line x1={sx(x)} y1={sz(base)} x2={sx(x)} y2={sz(tope)} stroke="rgba(148,163,184,0.4)" strokeWidth="1" strokeDasharray="5 4" />
          <circle cx={sx(x)} cy={sz(base) + 16} r="9" fill="#0b0e14" stroke="rgba(59,130,246,0.6)" strokeWidth="1" />
          <text x={sx(x)} y={sz(base) + 19} textAnchor="middle" fontSize="8" fill="#93c5fd" fontWeight="700">{etiquetaEjes === 'abc' ? ETIQUETAS_ABC[i % 26] : i + 1}</text>
        </g>
      ))}
      {niveles.slice(1).map((z, k) => (
        <text key={`nz${k}`} x={sx(ords[0]) - 18} y={sz(z) + 3} textAnchor="end" fontSize="8" fill="#64748b">+{z.toFixed(2).replace(/\.?0+$/, '')}</text>
      ))}
      {conPorticos && ords.map((x, i) => (
        <line key={`col${i}`} x1={sx(x)} y1={sz(base)} x2={sx(x)} y2={sz(tope)} stroke="rgba(226,232,240,0.85)" strokeWidth="3" />
      ))}
      {conPorticos && niveles.slice(1).map((z, k) => (
        <line key={`vig${k}`} x1={sx(ords[0])} y1={sz(z)} x2={sx(ords[ords.length - 1])} y2={sz(z)} stroke="rgba(52,211,153,0.85)" strokeWidth="3" />
      ))}
      {conApoyos && ords.map((x, i) => empotrado ? (
        <g key={`ap${i}`}>
          <rect x={sx(x) - 7} y={sz(base)} width="14" height="5" fill="#fbbf24" />
          <line x1={sx(x) - 9} y1={sz(base) + 8} x2={sx(x) + 9} y2={sz(base) + 8} stroke="#fbbf24" strokeWidth="1.5" />
        </g>
      ) : (
        <path key={`ap${i}`} d={`M ${sx(x)} ${sz(base)} l -8 10 l 16 0 Z`} fill="none" stroke="#fbbf24" strokeWidth="1.5" />
      ))}
      {etiquetaCargaViga && niveles.slice(1).map((z, k) => (
        <g key={`cg${k}`}>
          {ords.slice(0, -1).map((xa, i) => {
            const xm = (sx(xa) + sx(ords[i + 1])) / 2;
            return <g key={`fl${i}`}>
              <line x1={xm} y1={sz(z) - 14} x2={xm} y2={sz(z) - 3} stroke="#f87171" strokeWidth="1.5" />
              <path d={`M ${xm} ${sz(z) - 3} l -3 -5 l 6 0 Z`} fill="#f87171" />
            </g>;
          })}
          <line x1={sx(ords[0])} y1={sz(z) - 14} x2={sx(ords[ords.length - 1])} y2={sz(z) - 14} stroke="#f87171" strokeWidth="1" />
        </g>
      ))}
      {etiquetaCargaViga && <text x={(sx(ords[0]) + sx(ords[ords.length - 1])) / 2} y={sz(tope) - 20} textAnchor="middle" fontSize="9" fill="#fca5a5" fontWeight="700">{etiquetaCargaViga}</text>}
    </svg>
  );
}

// Seccion transversal de losa: maciza, nervada (1D) o waffle (2D).
function SvgSeccionLosa({ tipo, peralteCm, losaCm, anchoSupCm, anchoInfCm, separacionCm, separacion2Cm, width = 340 }) {
  const h = Number(peralteCm) || 20;
  const hf = Number(losaCm) || 5;
  const bs = Number(anchoSupCm) || 10;
  const bi = Number(anchoInfCm) || 10;
  const s = Number(separacionCm) || 40;
  const altura = 150;
  const M = 26;
  const anchoTotal = tipo === 'maciza' ? 100 : s * 2.5;
  const esc = (width - 2 * M) / anchoTotal;
  const escV = Math.min(esc, (altura - 2 * M - 14) / h);
  const yTop = M + 12;
  const yBotLosa = yTop + hf * escV;
  const yBot = yTop + h * escV;
  const relleno = 'rgba(59,130,246,0.18)';
  const borde = 'rgba(59,130,246,0.8)';
  if (tipo === 'maciza') {
    return (
      <svg width={width} height={altura} className="bg-black/30 rounded-lg border border-white/10">
        <rect x={M} y={yTop} width={width - 2 * M} height={h * escV} fill={relleno} stroke={borde} strokeWidth="1.5" />
        <line x1={width - M + 8} y1={yTop} x2={width - M + 8} y2={yBot} stroke="#94a3b8" strokeWidth="1" />
        <text x={width - M + 12} y={(yTop + yBot) / 2 + 3} fontSize="9" fill="#cbd5e1" fontWeight="700">h={h} cm</text>
        <text x={M} y={altura - 8} fontSize="8" fill="#64748b">Losa maciza: espesor constante de concreto</text>
      </svg>
    );
  }
  const viguetas = [];
  for (let cx = M + (s / 2) * esc; cx < width - M; cx += s * esc) {
    viguetas.push(cx);
  }
  return (
    <svg width={width} height={altura} className="bg-black/30 rounded-lg border border-white/10">
      <rect x={M} y={yTop} width={width - 2 * M} height={hf * escV} fill={relleno} stroke={borde} strokeWidth="1.5" />
      {viguetas.map((cx, i) => (
        <path key={i} d={`M ${cx - (bs / 2) * esc} ${yBotLosa} L ${cx + (bs / 2) * esc} ${yBotLosa} L ${cx + (bi / 2) * esc} ${yBot} L ${cx - (bi / 2) * esc} ${yBot} Z`}
          fill={relleno} stroke={borde} strokeWidth="1.5" />
      ))}
      <line x1={width - M + 8} y1={yTop} x2={width - M + 8} y2={yBot} stroke="#94a3b8" strokeWidth="1" />
      <text x={width - M + 11} y={(yTop + yBot) / 2 + 3} fontSize="9" fill="#cbd5e1" fontWeight="700">{h}</text>
      <text x={M - 4} y={(yTop + yBotLosa) / 2 + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{hf}</text>
      {viguetas.length >= 2 && (
        <g>
          <line x1={viguetas[0]} y1={yBot + 10} x2={viguetas[1]} y2={yBot + 10} stroke="#94a3b8" strokeWidth="1" />
          <text x={(viguetas[0] + viguetas[1]) / 2} y={yBot + 22} textAnchor="middle" fontSize="8" fill="#94a3b8">@ {s} cm</text>
        </g>
      )}
      <text x={M} y={altura - 6} fontSize="8" fill="#64748b">
        {tipo === 'waffle' ? `Waffle: nervios en 2 direcciones (@ ${s} x ${separacion2Cm || s} cm)` : `Nervada 1D: vigueta ${bs}/${bi} cm`}
      </text>
    </svg>
  );
}

// ============================================================================
// EL ESPECTRO DE DISENO (NORMA E.030-2026) — datos y calculo fieles a la hoja
// "ESPECTRO DE RESPUESTA SISMICA - 2026.xlsx" del usuario (tablas N1, N4/N5, N7,
// sistemas, irregularidades N10). Reemplaza la pestana "Vista previa".
// ============================================================================
// Factor de zona "Z" (Tabla N1). col = indice de columna de suelo (Z4..Z1).
const ZONAS_E030 = [
  { id: 'Z4', nombre: 'Zona 4', z: 0.45, col: 0 },
  { id: 'Z3', nombre: 'Zona 3', z: 0.35, col: 1 },
  { id: 'Z2', nombre: 'Zona 2', z: 0.25, col: 2 },
  { id: 'Z1', nombre: 'Zona 1', z: 0.10, col: 3 },
];
// Factor de suelo "S" por zona [Z4, Z3, Z2, Z1] + TP, TL (Tablas N4 y N5).
// S4 en Zona 4 no esta tabulado (requiere EMS) -> null.
const SUELOS_E030 = [
  { id: 'S0', nombre: 'S0 · Roca',               s: [0.80, 0.80, 0.80, 0.80], tp: 0.3, tl: 3.0 },
  { id: 'S1', nombre: 'S1 · Suelos muy rígidos', s: [1.00, 1.00, 1.00, 1.00], tp: 0.4, tl: 3.0 },
  { id: 'S2', nombre: 'S2 · Suelos rígidos',     s: [1.10, 1.15, 1.30, 1.30], tp: 0.6, tl: 3.0 },
  { id: 'S3', nombre: 'S3 · Suelos intermedios', s: [1.20, 1.20, 1.40, 1.60], tp: 0.9, tl: 2.5 },
  { id: 'S4', nombre: 'S4 · Suelos blandos',     s: [null, 1.30, 1.60, 2.40], tp: 1.2, tl: 2.0 },
];
// Factor de uso "U" (Tabla N7).
const USOS_E030 = [
  { id: 'A1', nombre: 'A1 · Edificaciones esenciales', u: 1.5 },
  { id: 'A2', nombre: 'A2 · Edificaciones esenciales', u: 1.5 },
  { id: 'B',  nombre: 'B · Edificaciones importantes', u: 1.3 },
  { id: 'C',  nombre: 'C · Edificaciones comunes',     u: 1.0 },
];
// Sistema estructural -> coeficiente basico R0.
const SISTEMAS_E030 = [
  { id: 'ca',    nombre: 'Pórticos de concreto armado', r0: 8 },
  { id: 'dual',  nombre: 'Sistema dual', r0: 7 },
  { id: 'muros', nombre: 'Muros estructurales', r0: 6 },
  { id: 'mdl',   nombre: 'Muros de ductilidad limitada', r0: 3.5 },
  { id: 'alb',   nombre: 'Albañilería armada o confinada', r0: 3 },
  { id: 'smf',   nombre: 'Pórticos especiales resistentes a momentos (SMF)', r0: 8 },
  { id: 'imf',   nombre: 'Pórticos intermedios resistentes a momentos (IMF)', r0: 5 },
  { id: 'omf',   nombre: 'Pórticos ordinarios resistentes a momentos (OMF)', r0: 4 },
  { id: 'scbf',  nombre: 'Pórticos especiales concéntricamente arriostrados (SCBF)', r0: 7 },
  { id: 'ocbf',  nombre: 'Pórticos ordinarios concéntricamente arriostrados (OCBF)', r0: 4 },
  { id: 'ebf',   nombre: 'Pórticos excéntricamente arriostrados (EBF)', r0: 8 },
  { id: 'madera',nombre: 'Madera (por esfuerzos admisibles)', r0: 7 },
];
// SISTEMAS ESTRUCTURALES de concreto armado (E.030 Tabla N°8, Artículo 20): se clasifican por el
// % de la fuerza CORTANTE EN LA BASE que toman los muros. `sis` = id en SISTEMAS_E030 (fija R0).
const SISTEMAS_TABLA8 = [
  { id: 'porticos', nombre: 'Pórticos', sis: 'ca', r0: 8, rango: 'muros ≤ 20% del cortante basal',
    criterio: 'Por lo menos el 80% de la fuerza cortante en la base actúa sobre las columnas de los pórticos. En caso se tengan muros estructurales, éstos se diseñan para resistir una fracción de la acción sísmica total de acuerdo con su rigidez.' },
  { id: 'muros', nombre: 'Muros estructurales', sis: 'muros', r0: 6, rango: 'muros ≥ 70%',
    criterio: 'La resistencia sísmica está dada predominantemente por muros dúctiles sobre los que actúa por lo menos el 70% de la fuerza cortante en la base.' },
  { id: 'dual', nombre: 'Dual', sis: 'dual', r0: 7, rango: '20% < muros < 70%',
    criterio: 'Las acciones sísmicas son resistidas por una combinación de pórticos y muros estructurales. La fuerza cortante que toman los muros es mayor que 20% y menor que 70% del cortante en la base del edificio.' },
  { id: 'emdl', nombre: 'Muros de ductilidad limitada (EMDL)', sis: 'mdl', r0: 3.5, rango: 'densidad de muros > 2,5% por piso · máx. 5 pisos',
    criterio: 'La resistencia sísmica y de cargas de gravedad está dada por una alta densidad de muros de concreto armado (mayor a 2,5% por piso) de espesores reducidos, como mínimo de 10 cm, en los que se prescinde de extremos confinados y el refuerzo vertical se dispone en una sola capa. Con este sistema se puede construir como máximo cinco (05) pisos.' },
];
// Clasifica el sistema (concreto) por la fracción del cortante basal que toman los muros (0..1).
// Devuelve el id de SISTEMAS_TABLA8 o null si no hay dato. EMDL no se deduce solo del cortante
// (requiere densidad de muros) → se ofrece como elección manual.
function clasificarSistemaMuros(frac) {
  if (frac == null || isNaN(frac)) return null;
  if (frac >= 0.70) return 'muros';
  if (frac > 0.20) return 'dual';
  return 'porticos';
}
// Irregularidades en ALTURA (Ia, Tabla N°11) y PLANTA (Ip, Tabla N°12): factor por tipo.
// El factor final por direccion = MINIMO de las marcadas (1 si ninguna).
// Cada item lleva, ademas del factor: `tabla` (N° de la norma), `umbral` (criterio corto),
// `criterio` (texto fiel a la E.030-2026), `como` (de donde sale el dato para verificarla)
// y `esquema` (clave del dibujo en EsquemaIrreg). id/nombre/f NO cambian (los usan el
// calculo del espectro, la tabla de la pestana y la memoria LaTeX).
const IRREG_ALTURA = [
  { id: 'rigidez', nombre: 'Rigidez – Piso blando', f: 0.75, tabla: 'N°11', esquema: 'pisoBlando',
    umbral: 'K_piso < 0,70·K_sup  (o < 0,80 del promedio de los 3 superiores)',
    criterio: 'Existe cuando, en cualquier dirección de análisis, en un entrepiso la rigidez lateral es menor que 70% de la del entrepiso inmediato superior, o menor que 80% de la rigidez lateral promedio de los tres niveles superiores. Las rigideces se calculan como la razón entre la fuerza cortante del entrepiso y su desplazamiento relativo en el centro de masas.',
    como: 'Rigidez de entrepiso = V_entrepiso / Δ_relativo (Story Stiffness / Story Drifts de ETABS).' },
  { id: 'resistencia', nombre: 'Resistencia – Piso débil', f: 0.75, tabla: 'N°11', esquema: 'pisoDebil',
    umbral: 'V_resistente_piso < 0,80·V_resistente_sup',
    criterio: 'Existe cuando, en cualquier dirección de análisis, la resistencia de un entrepiso frente a fuerzas cortantes es inferior a 80% de la resistencia del entrepiso inmediato superior.',
    como: 'Resistencia a cortante del entrepiso (capacidad de columnas y muros del nivel).' },
  { id: 'rigidezExt', nombre: 'Extrema de rigidez', f: 0.50, tabla: 'N°13', esquema: 'pisoBlando',
    umbral: 'K_piso < 0,60·K_sup  (o < 0,70 del promedio de los 3 superiores)',
    criterio: 'Irregularidad extrema de rigidez: existe cuando la rigidez lateral de un entrepiso es menor que 60% de la del entrepiso inmediato superior, o menor que 70% de la rigidez lateral promedio de los tres niveles superiores adyacentes.',
    como: 'Igual que Piso blando, con umbral 0,60 / 0,70 (estructura no permitida en zonas 3 y 4 con categoría A/B).' },
  { id: 'resistExt', nombre: 'Extrema de resistencia', f: 0.50, tabla: 'N°13', esquema: 'pisoDebil',
    umbral: 'V_resistente_piso < 0,65·V_resistente_sup',
    criterio: 'Irregularidad extrema de resistencia: existe cuando la resistencia de un entrepiso frente a fuerzas cortantes es inferior a 65% de la resistencia del entrepiso inmediato superior.',
    como: 'Igual que Piso débil, con umbral 0,65.' },
  { id: 'masa', nombre: 'Masa o peso', f: 0.90, tabla: 'N°11', esquema: 'masa',
    umbral: 'P_piso > 1,5·P_adyacente',
    criterio: 'Se tiene irregularidad de masa (o peso) cuando el peso de un piso, determinado según el artículo de masas de la Norma, es mayor que 1,5 veces el peso de un piso adyacente. Este criterio no se aplica en azoteas ni en sótanos.',
    como: 'Peso/masa por piso (tabla "Mass Summary by Story" de ETABS).' },
  { id: 'geomVert', nombre: 'Geométrica vertical', f: 0.90, tabla: 'N°11', esquema: 'geomVert',
    umbral: 'L_piso > 1,3·L_adyacente',
    criterio: 'La configuración es irregular cuando, en cualquier dirección de análisis, la dimensión en planta de la estructura resistente a cargas laterales es mayor que 1,3 veces la correspondiente dimensión en un piso adyacente. No se aplica en azoteas ni en sótanos.',
    como: 'Dimensión en planta del sistema resistente, piso a piso (geometría del modelo).' },
  { id: 'disc', nombre: 'Discontinuidad de sistemas resistentes', f: 0.80, tabla: 'N°11', esquema: 'discontinuidad',
    umbral: 'desalineamiento del eje > 25% de la dimensión del elemento',
    criterio: 'Se califica como irregular cuando en cualquier elemento que resista más de 10% de la fuerza cortante se tiene un desalineamiento vertical, tanto por un cambio de orientación como por un desplazamiento del eje de magnitud mayor que 25% de la correspondiente dimensión del elemento.',
    como: 'Continuidad vertical de columnas y muros (conectividad de la geometría).' },
  { id: 'discExt', nombre: 'Discontinuidad extrema', f: 0.60, tabla: 'N°13', esquema: 'discontinuidad',
    umbral: 'V_elementos_discontinuos > 25% de la cortante total',
    criterio: 'Existe discontinuidad extrema cuando la fuerza cortante que resisten los elementos discontinuos descritos en el ítem anterior supera el 25% de la fuerza cortante total.',
    como: 'Fracción de la cortante de piso tomada por los elementos discontinuos.' },
];
const IRREG_PLANTA = [
  { id: 'torsion', nombre: 'Torsional', f: 0.75, tabla: 'N°12', esquema: 'torsion',
    umbral: 'Δmax > 1,3·Δprom  (y Δmax > 50% del permisible)',
    criterio: 'Existe cuando, en cualquier dirección de análisis, el máximo desplazamiento relativo de entrepiso en un extremo del edificio (Δmax), calculado incluyendo excentricidad accidental, es mayor que 1,3 veces el desplazamiento relativo promedio de los extremos del mismo entrepiso (Δprom). Solo se aplica en edificios con diafragmas rígidos y cuando Δmax es mayor que 50% del desplazamiento permisible.',
    como: 'Δmax y Δprom por entrepiso en los extremos, con excentricidad accidental ±5% (Story Drifts de ETABS).' },
  { id: 'torsionExt', nombre: 'Torsional extrema', f: 0.60, tabla: 'N°13', esquema: 'torsion',
    umbral: 'Δmax > 1,5·Δprom  (y Δmax > 50% del permisible)',
    criterio: 'Existe irregularidad torsional extrema cuando, en cualquier dirección de análisis, el máximo desplazamiento relativo de entrepiso en un extremo (Δmax), incluyendo excentricidad accidental, es mayor que 1,5 veces el desplazamiento relativo promedio de los extremos del mismo entrepiso (Δprom). Solo se aplica con diafragmas rígidos y cuando Δmax es mayor que 50% del permisible.',
    como: 'Igual que Torsional, con umbral 1,5.' },
  { id: 'esquinas', nombre: 'Esquinas entrantes', f: 0.90, tabla: 'N°12', esquema: 'esquinas',
    umbral: 'esquina entrante > 20% de la dimensión total en ambas direcciones',
    criterio: 'La estructura se califica como irregular cuando tiene esquinas entrantes cuyas dimensiones en ambas direcciones son mayores que 20% de la correspondiente dimensión total en planta.',
    como: 'Geometría en planta: dimensión de las esquinas entrantes vs. dimensión total.' },
  { id: 'diafragma', nombre: 'Discontinuidad del diafragma', f: 0.85, tabla: 'N°12', esquema: 'diafragmaPlanta',
    umbral: 'abertura > 50% del área bruta  (o A_neta < 25% de la sección)',
    criterio: 'Se califica como irregular cuando los diafragmas tienen discontinuidades abruptas o variaciones importantes en rigidez, incluyendo aberturas mayores que 50% del área bruta del diafragma; o cuando alguna sección transversal del diafragma tiene un área neta resistente menor que 25% del área de la sección transversal total calculada con la dimensión total en planta.',
    como: 'Aberturas del diafragma y continuidad de la losa (geometría de las áreas).' },
  { id: 'noParalelo', nombre: 'Sistemas no paralelos', f: 0.90, tabla: 'N°12', esquema: 'noParalelo',
    umbral: 'ejes resistentes no paralelos (ángulo ≥ 30°)',
    criterio: 'Existe cuando, en cualquier dirección de análisis, los elementos resistentes a fuerzas laterales no son paralelos. No se aplica si los ejes de los pórticos o muros forman ángulos menores que 30°, ni cuando los elementos no paralelos resisten menos que 10% de la fuerza cortante del piso.',
    como: 'Orientación de los ejes resistentes en planta (ángulos entre pórticos/muros).' },
];
// Las 13 irregularidades como NODOS del diagrama (cada una su propio boton bajo el paso
// "Verificar irregularidades"). grupo 'A'=altura (campos iaX/iaY) / 'P'=planta (ipX/ipY).
const IRREG_NODOS = [
  ...IRREG_ALTURA.map(it => ({ ...it, grupo: 'A', cX: 'iaX', cY: 'iaY' })),
  ...IRREG_PLANTA.map(it => ({ ...it, grupo: 'P', cX: 'ipX', cY: 'ipY' })),
];
// ESQUEMAS de las irregularidades (dibujo didactico por tipo, fiel a la E.030).
// `tipo` = clave `esquema` de IRREG_ALTURA/IRREG_PLANTA. SVG vectorial, sin deps.
// Elevaciones (vista lateral) para las de ALTURA; plantas (vista superior) para las de PLANTA.
function EsquemaIrreg({ tipo, w = 220 }) {
  const slate = '#94a3b8', slateD = '#64748b', rose = '#fb7185';
  const roseF = 'rgba(251,113,133,0.16)', amber = '#fbbf24', sky = '#38bdf8';
  const planeF = 'rgba(148,163,184,0.07)', wallF = 'rgba(148,163,184,0.20)';
  const wrap = (children) => (
    <svg viewBox="0 0 230 150" width={w} height={Math.round((w * 150) / 230)} className="block" style={{ maxWidth: '100%' }}>
      <rect x="0" y="0" width="230" height="150" rx="10" fill="rgba(0,0,0,0.22)" stroke="rgba(255,255,255,0.05)" />
      {children}
    </svg>
  );
  // Suelo + hachura (base de las elevaciones).
  const suelo = (y = 132, x0 = 18, x1 = 212) => (
    <g>
      <line x1={x0} y1={y} x2={x1} y2={y} stroke={slate} strokeWidth="2" />
      {Array.from({ length: 11 }, (_, i) => <line key={i} x1={x0 + 6 + i * 18} y1={y} x2={x0 - 2 + i * 18} y2={y + 8} stroke={slateD} strokeWidth="1" />)}
    </g>
  );
  // Marco de elevacion: 3 columnas + 4 losas superiores (entrepiso blando/debil = el de la base).
  const marcoElev = (
    <g stroke={slate} strokeWidth="2" fill="none">
      <line x1="40" y1="132" x2="40" y2="18" /><line x1="115" y1="132" x2="115" y2="18" /><line x1="190" y1="132" x2="190" y2="18" />
      {[18, 42, 68, 94].map(y => <line key={y} x1="40" y1={y} x2="190" y2={y} />)}
    </g>
  );
  const etq = (x, y, t, fill = rose) => <text x={x} y={y} textAnchor="middle" fontSize="8.5" fontWeight="700" fill={fill}>{t}</text>;

  switch (tipo) {
    case 'pisoBlando': return wrap(<>
      {suelo()}{marcoElev}
      {/* arriostres en los 3 pisos superiores = rigidez alta */}
      {[[18, 42], [42, 68], [68, 94]].map(([yt, yb], i) => (
        <g key={i} stroke={sky} strokeWidth="1.5" opacity="0.85">
          <line x1="40" y1={yb} x2="190" y2={yt} /><line x1="190" y1={yb} x2="40" y2={yt} />
        </g>
      ))}
      {/* entrepiso de la base SIN arriostre = piso blando */}
      <rect x="40" y="94" width="150" height="38" fill={roseF} stroke={rose} strokeWidth="1.4" strokeDasharray="4 3" />
      {etq(115, 117, 'piso blando')}
    </>);
    case 'pisoDebil': return wrap(<>
      {suelo()}{marcoElev}
      {/* muros (resistencia) en los pisos superiores */}
      {[[18, 42], [42, 68], [68, 94]].map(([yt, yb], i) => (
        <rect key={i} x="98" y={yt + 3} width="34" height={yb - yt - 6} fill={wallF} stroke={slate} strokeWidth="1" />
      ))}
      {/* entrepiso de la base SIN muro = piso debil */}
      <rect x="40" y="94" width="150" height="38" fill={roseF} stroke={rose} strokeWidth="1.4" strokeDasharray="4 3" />
      {etq(115, 117, 'piso débil')}
    </>);
    case 'masa': return wrap(<>
      {suelo()}
      <g stroke={slate} strokeWidth="2"><line x1="55" y1="132" x2="55" y2="20" /><line x1="175" y1="132" x2="175" y2="20" /></g>
      {[20, 52, 108].map(y => <line key={y} x1="55" y1={y} x2="175" y2={y} stroke={slate} strokeWidth="2" />)}
      {/* losa pesada en un piso intermedio */}
      <rect x="49" y="74" width="132" height="14" fill={roseF} stroke={rose} strokeWidth="1.6" />
      {[70, 92, 114, 136, 158].map(x => <circle key={x} cx={x} cy="69" r="3.1" fill={rose} />)}
      {etq(115, 104, 'P > 1,5 P')}
    </>);
    case 'geomVert': return wrap(<>
      {suelo()}
      {/* dos pisos base angostos */}
      <rect x="72" y="98" width="86" height="34" fill={planeF} stroke={slate} strokeWidth="2" />
      <line x1="72" y1="115" x2="158" y2="115" stroke={slate} strokeWidth="1.3" />
      {/* piso que sobresale = irregular */}
      <rect x="40" y="70" width="150" height="28" fill={roseF} stroke={rose} strokeWidth="1.8" />
      {/* piso superior angosto */}
      <rect x="85" y="44" width="60" height="26" fill={planeF} stroke={slate} strokeWidth="2" />
      {/* cotas L (base) y L' (saliente) */}
      <g stroke={amber} strokeWidth="1"><line x1="40" y1="64" x2="190" y2="64" /><line x1="72" y1="140" x2="158" y2="140" /></g>
      <text x="115" y="61" textAnchor="middle" fontSize="8" fill={amber}>L′</text>
      <text x="115" y="148" textAnchor="middle" fontSize="8" fill={amber}>L</text>
      {etq(206, 84, '>1,3L', rose)}
    </>);
    case 'discontinuidad': return wrap(<>
      {suelo()}
      {[28, 72, 116].map(y => <line key={y} x1="35" y1={y} x2="195" y2={y} stroke={slate} strokeWidth="2" />)}
      <g stroke={slate} strokeWidth="2"><line x1="35" y1="132" x2="35" y2="28" /><line x1="195" y1="132" x2="195" y2="28" /></g>
      {/* muro superior que NO continua hacia abajo */}
      <rect x="138" y="28" width="26" height="44" fill={wallF} stroke={slate} strokeWidth="1.4" />
      {/* abajo el elemento esta desalineado */}
      <rect x="68" y="72" width="26" height="44" fill={roseF} stroke={rose} strokeWidth="1.6" />
      <line x1="151" y1="72" x2="81" y2="72" stroke={rose} strokeWidth="1.2" strokeDasharray="3 3" />
      {etq(116, 67, 'desalineado')}
    </>);
    case 'torsion': return wrap(<>
      {/* planta original */}
      <rect x="55" y="42" width="120" height="66" fill={planeF} stroke={slate} strokeWidth="2" />
      <circle cx="115" cy="75" r="2.6" fill={amber} /><text x="115" y="89" textAnchor="middle" fontSize="7" fill={amber}>CM</text>
      {/* planta girada (desplazada) = torsion */}
      <polygon points="60,34 190,48 184,110 56,100" fill="none" stroke={rose} strokeWidth="1.6" strokeDasharray="4 3" />
      {/* Δmax (esquina que mas se mueve) vs Δprom */}
      <line x1="175" y1="42" x2="190" y2="48" stroke={rose} strokeWidth="2" />
      <circle cx="190" cy="48" r="2.4" fill={rose} />
      {etq(196, 38, 'Δmax')}
      <text x="48" y="116" textAnchor="middle" fontSize="8" fontWeight="700" fill={slate}>Δprom</text>
    </>);
    case 'esquinas': return wrap(<>
      {/* planta en L con esquina entrante */}
      <path d="M 48 36 L 150 36 L 150 80 L 182 80 L 182 116 L 48 116 Z" fill={planeF} stroke={slate} strokeWidth="2" />
      <path d="M 150 36 L 150 80 L 182 80" fill="none" stroke={rose} strokeWidth="2" />
      <circle cx="150" cy="80" r="4" fill="none" stroke={rose} strokeWidth="1.8" />
      {/* cotas de la esquina entrante */}
      <g stroke={amber} strokeWidth="1"><line x1="150" y1="28" x2="182" y2="28" /><line x1="190" y1="80" x2="190" y2="116" /></g>
      <text x="166" y="25" textAnchor="middle" fontSize="7.5" fill={amber}>a</text>
      <text x="198" y="100" textAnchor="middle" fontSize="7.5" fill={amber}>b</text>
      {etq(95, 132, 'a, b > 20% de A, B')}
    </>);
    case 'diafragmaPlanta': return wrap(<>
      <rect x="45" y="34" width="140" height="82" fill={planeF} stroke={slate} strokeWidth="2" />
      {/* abertura grande */}
      <rect x="84" y="54" width="74" height="44" fill={roseF} stroke={rose} strokeWidth="1.8" strokeDasharray="5 3" />
      <line x1="84" y1="98" x2="158" y2="54" stroke={rose} strokeWidth="1" />
      <line x1="84" y1="54" x2="158" y2="98" stroke={rose} strokeWidth="1" />
      {etq(115, 132, 'abertura > 50% del área')}
    </>);
    case 'noParalelo': return wrap(<>
      <rect x="45" y="34" width="140" height="82" fill={planeF} stroke={slate} strokeWidth="2" />
      {/* eje 1 (vertical) y eje 2 (no paralelo, inclinado) */}
      <line x1="80" y1="40" x2="80" y2="110" stroke={sky} strokeWidth="3" />
      <line x1="118" y1="110" x2="162" y2="42" stroke={rose} strokeWidth="3" />
      <path d="M 118 96 A 16 16 0 0 1 130 82" fill="none" stroke={amber} strokeWidth="1.3" />
      <text x="142" y="98" fontSize="8" fontWeight="700" fill={amber}>≥30°</text>
      {etq(115, 132, 'ejes no paralelos')}
    </>);
    default: return wrap(<text x="115" y="78" textAnchor="middle" fontSize="9" fill={slateD}>—</text>);
  }
}

// Vector de periodos T (s) de la hoja (col R) = el mismo de buildSpectrumBody.
const PERIODOS_E030 = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2,
  0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9,
  0.95, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.25, 2.5, 2.75, 3,
  4, 5, 6, 7, 8, 9, 10];
const G_E030 = 9.81;   // gravedad de la hoja del usuario (m/s2)
// Factor de amplificacion sismica C (E.030, con la rama corta 1+7.5*T/Tp).
function cFactorE030(t, TP, TL) {
  if (t < 0.2 * TP) return 1 + 7.5 * (t / TP);
  if (t <= TP) return 2.5;
  if (t < TL) return 2.5 * TP / t;
  return 2.5 * TP * TL / (t * t);
}
// Calcula todo el espectro de diseno a partir de los parametros elegidos.
function calcEspectroDiseno(d) {
  const zona = ZONAS_E030.find(z => z.id === d.zona) || ZONAS_E030[0];
  const suelo = SUELOS_E030.find(s => s.id === d.suelo) || SUELOS_E030[1];
  const uso = USOS_E030.find(u => u.id === d.uso) || USOS_E030[3];
  const sisX = SISTEMAS_E030.find(s => s.id === d.sistemaX) || SISTEMAS_E030[0];
  const sisY = SISTEMAS_E030.find(s => s.id === d.sistemaY) || SISTEMAS_E030[0];
  const Z = zona.z, U = uso.u;
  const S = suelo.s[zona.col];           // null si no esta tabulado (S4/Z4)
  const TP = suelo.tp, TL = suelo.tl;
  const minSel = (lista, arr) => lista.reduce((m, it) => (arr || []).includes(it.id) ? Math.min(m, it.f) : m, 1);
  const Iax = minSel(IRREG_ALTURA, d.iaX), Iay = minSel(IRREG_ALTURA, d.iaY);
  const Ipx = minSel(IRREG_PLANTA, d.ipX), Ipy = minSel(IRREG_PLANTA, d.ipY);
  const Rx = sisX.r0 * Iax * Ipx, Ry = sisY.r0 * Iay * Ipy;
  const g = d.adimensional ? 1 : G_E030;
  const valido = S != null && Rx > 0 && Ry > 0;
  const puntos = PERIODOS_E030.map(t => {
    const c = cFactorE030(t, TP, TL);
    return { t, c, sax: valido ? Z * U * c * S * g / Rx : 0, say: valido ? Z * U * c * S * g / Ry : 0 };
  });
  return {
    zona, suelo, uso, sisX, sisY, Z, U, S, TP, TL,
    Iax, Iay, Ipx, Ipy, R0x: sisX.r0, R0y: sisY.r0, Rx, Ry, g, valido, puntos,
    saMaxX: valido ? Z * U * 2.5 * S * g / Rx : 0,
    saMaxY: valido ? Z * U * 2.5 * S * g / Ry : 0,
  };
}

// VERIFICACION AUTOMATICA de la irregularidad de MASA O PESO (E.030 Tabla N°11, Ia=0.90):
// "el peso de un piso es mayor que 1,5 veces el peso de un piso adyacente. No se aplica en
// azoteas ni sotanos." Recibe las masas por piso de "Mass Summary by Story" (tope->base,
// masa en tonne; el factor g se cancela en la razon -> usar masa equivale a usar peso).
// Excluye Base/Total y EXENTA azotea (tope) y sotanos; compara cada piso evaluable con sus
// pisos adyacentes evaluables. El usuario ve la tabla y puede ajustar el check a mano.
function calcMasaIrreg(masas) {
  const excl = (p) => /^(base|total|σ|sum)/i.test(String(p || '').trim());
  const esSotano = (p) => /sotano|sótano|basement|subsuelo/i.test(String(p || ''));
  const arr0 = (masas || [])
    .filter(m => !excl(m.piso))
    .map(m => ({ piso: m.piso, masa: Math.max(Number(m.masa_x) || 0, Number(m.masa_y) || 0) }));
  const arr = arr0.map((m, i) => ({
    ...m,
    exenta: i === 0 || esSotano(m.piso),
    motivo: i === 0 ? 'azotea' : (esSotano(m.piso) ? 'sótano' : null),
  }));
  const evals = arr.filter(m => !m.exenta && m.masa > 0);
  const filas = arr.map(m => {
    if (m.exenta || m.masa <= 0) return { ...m, arriba: null, abajo: null, rel: null, viola: false };
    const idx = evals.findIndex(e => e.piso === m.piso);
    const arriba = idx > 0 ? evals[idx - 1].masa : null;            // piso evaluable superior
    const abajo = idx >= 0 && idx < evals.length - 1 ? evals[idx + 1].masa : null;  // inferior
    const rArr = arriba ? m.masa / arriba : null;
    const rAb = abajo ? m.masa / abajo : null;
    const rel = Math.max(rArr || 0, rAb || 0) || null;              // razon gobernante
    return { ...m, arriba, abajo, rel, viola: !!(rel && rel > 1.5) };
  });
  return { filas, irregular: filas.some(f => f.viola) };
}

// VERIFICACION AUTOMATICA de la irregularidad TORSIONAL (E.030 Tabla N°12, Ip=0.75; extrema
// Tabla N°13, Ip=0.60). Recibe las filas de "Story Max Over Avg Drifts" (piso, caso, dir X/Y,
// max_drift, avg_drift, ratio = Delta_max/Delta_prom). Por DIRECCION (X e Y, independientes):
// solo cuentan los pisos con Delta_max > 50% del permisible (E.030: "solo si Δmax > 50% del
// permisible"); entre ellos, la razon GOBERNANTE: > 1,5 -> torsional EXTREMA, > 1,3 -> torsional.
function calcTorsionIrreg(drifts, limite = 0.007) {
  const umbralDeriva = 0.5 * limite;
  const porDir = (dl) => {
    const filas = (drifts || [])
      .filter(r => String(r.dir).trim().toUpperCase().startsWith(dl))
      .map(r => ({ piso: r.piso, caso: r.caso, maxDrift: Number(r.max_drift) || 0, ratio: Number(r.ratio) || 0,
                   exenta: !((Number(r.max_drift) || 0) > umbralDeriva) }))
      .sort((a, b) => b.ratio - a.ratio);
    const evals = filas.filter(f => !f.exenta);
    const peor = evals.length ? evals[0] : null;
    const ratioMax = peor ? peor.ratio : 0;
    const tipo = ratioMax > 1.5 ? 'torsionExt' : ratioMax > 1.3 ? 'torsion' : null;
    return { filas, peor, ratioMax, tipo };
  };
  return { x: porDir('X'), y: porDir('Y') };
}

// VERIFICACION AUTOMATICA de la irregularidad de RIGIDEZ / PISO BLANDO (E.030 Tabla N°11,
// Ia=0.75; extrema Tabla N°13, Ia=0.50). Recibe filas de "Story Stiffness" {piso, caso,
// stiffX, stiffY} en orden tope->base. Por DIRECCION (X/Y): K de cada piso vs el entrepiso
// INMEDIATO SUPERIOR y vs el PROMEDIO de los 3 superiores. Piso blando: K<0,70·K_sup o
// K<0,80·prom3. Extrema: K<0,60·K_sup o K<0,70·prom3. El piso TOPE no se evalua (sin superior).
function calcRigidezIrreg(rows, casoX, casoY) {
  const porDir = (caso, key) => {
    let rs = caso ? (rows || []).filter(r => String(r.caso) === String(caso)) : [];
    if (!rs.length) rs = rows || [];
    const seen = new Set();
    const lst = [];
    for (const r of rs) {
      if (!seen.has(r.piso)) { seen.add(r.piso); lst.push({ piso: r.piso, K: Number(r[key]) || 0 }); }
    }
    const filas = lst.map((m, j) => {
      if (j === 0 || m.K <= 0) return { ...m, ksup: null, prom3: null, rel: null, relProm: null, tipo: null, exenta: j === 0 };
      const ksup = lst[j - 1].K;
      const arr3 = lst.slice(Math.max(0, j - 3), j).map(x => x.K).filter(v => v > 0);
      const prom3 = arr3.length ? arr3.reduce((s, v) => s + v, 0) / arr3.length : null;
      const rel = ksup > 0 ? m.K / ksup : null;
      const relProm = prom3 ? m.K / prom3 : null;
      const ext = (rel != null && rel < 0.60) || (relProm != null && relProm < 0.70);
      const blando = (rel != null && rel < 0.70) || (relProm != null && relProm < 0.80);
      return { ...m, ksup, prom3, rel, relProm, exenta: false, tipo: ext ? 'rigidezExt' : blando ? 'rigidez' : null };
    });
    const flag = filas.filter(f => f.tipo);
    const peor = flag.sort((a, b) => (a.rel ?? 9) - (b.rel ?? 9))[0] || null;
    const tipo = filas.some(f => f.tipo === 'rigidezExt') ? 'rigidezExt' : filas.some(f => f.tipo === 'rigidez') ? 'rigidez' : null;
    return { filas, peor, tipo };
  };
  return { x: porDir(casoX, 'stiffX'), y: porDir(casoY, 'stiffY') };
}

// --- IRREGULARIDADES GEOMETRICAS (se calculan de la GEOMETRIA del modelo, SIN analisis) ---
// Reciben `elementos` de /etabs/modelo-geometria: columna{x,y,nivel} · viga/muro{x1,y1,x2,y2,nivel}
// · losa{pts:[{x,y}],nivel}. `nivel` = indice de piso (1..n, 0 = base).

// GEOMETRICA VERTICAL (E.030 Tabla N°11, Ia=0.90): la dimension en planta del sistema resistente
// es > 1,3 veces la del piso adyacente (por direccion X/Y). No aplica en azotea (tope) ni sotanos.
function calcGeomVertical(elementos) {
  const st = {};
  const acc = (k, xs, ys) => {
    if (!k) return;
    const s = st[k] || (st[k] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    xs.forEach(x => { if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x; });
    ys.forEach(y => { if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y; });
  };
  (elementos || []).forEach(e => {
    if (e.tipo === 'columna') acc(e.nivel, [e.x], [e.y]);
    else if (e.tipo === 'viga' || e.tipo === 'muro') acc(e.nivel, [e.x1, e.x2], [e.y1, e.y2]);
  });
  const ks = Object.keys(st).map(Number).sort((a, b) => a - b);
  const dims = ks.map(k => ({ nivel: k, dimX: st[k].maxX - st[k].minX, dimY: st[k].maxY - st[k].minY }));
  const evalDir = (key) => {
    // conjunto evaluable: excluye el piso TOPE (azotea)
    const ev = dims.slice(0, Math.max(0, dims.length - 1));
    const filas = ev.map((d, i) => {
      const vecinos = [ev[i - 1], ev[i + 1]].filter(Boolean).map(v => v[key]).filter(v => v > 0);
      const rel = vecinos.length ? Math.max(...vecinos.map(v => d[key] / v)) : 0;
      return { nivel: d.nivel, dim: d[key], rel, viola: rel > 1.3 };
    });
    return { filas, irregular: filas.some(f => f.viola) };
  };
  return { x: evalDir('dimX'), y: evalDir('dimY'), nTope: dims.length };
}

// DISCONTINUIDAD DEL DIAFRAGMA (E.030 Tabla N°12, Ip=0.85): aberturas > 50% del area bruta del
// diafragma (area de losa < 50% del rectangulo envolvente del piso). No direccional.
function calcDiafragmaIrreg(elementos) {
  const area2d = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
    return Math.abs(a) / 2;
  };
  const by = {};
  (elementos || []).forEach(e => { (by[e.nivel] = by[e.nivel] || []).push(e); });
  const filas = [];
  Object.keys(by).map(Number).sort((a, b) => a - b).forEach(k => {
    if (!k) return;
    const els = by[k];
    const losas = els.filter(e => e.tipo === 'losa');
    if (!losas.length) return;                       // sin diafragma que evaluar
    const slab = losas.reduce((s, l) => s + area2d(l.pts || []), 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const acc = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
    els.forEach(e => {
      if (e.tipo === 'columna') acc(e.x, e.y);
      else if (e.tipo === 'viga' || e.tipo === 'muro') { acc(e.x1, e.y1); acc(e.x2, e.y2); }
      else if (e.tipo === 'losa') (e.pts || []).forEach(p => acc(p.x, p.y));
    });
    const gross = (maxX > minX && maxY > minY) ? (maxX - minX) * (maxY - minY) : 0;
    const frac = gross > 0 ? slab / gross : 1;
    filas.push({ nivel: k, slab, gross, frac, abertura: Math.max(0, 1 - frac), viola: gross > 0 && frac < 0.5 });
  });
  return { filas, irregular: filas.some(f => f.viola) };
}

// SISTEMAS NO PARALELOS (E.030 Tabla N°12, Ip=0.90): elementos resistentes (muros, ejes) no
// paralelos a los ejes principales. No aplica si forman angulos < 30°. (El criterio del 10% de
// la cortante necesita analisis -> se reporta y el usuario confirma.)
function calcNoParaleloIrreg(elementos) {
  const desv = (x1, y1, x2, y2) => {
    const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const a = ((ang % 90) + 90) % 90;     // 0..90
    return Math.min(a, 90 - a);            // desviacion del eje mas cercano, 0..45
  };
  const inclin = [];
  (elementos || []).forEach(e => {
    if (e.tipo === 'muro' || e.tipo === 'viga') {
      const d = desv(e.x1, e.y1, e.x2, e.y2);
      if (d >= 30 - 1e-6) inclin.push({ tipo: e.tipo, name: e.name, desv: Math.round(d * 10) / 10, nivel: e.nivel });
    }
  });
  // prioriza muros (elementos laterales claros) en el listado
  inclin.sort((a, b) => (a.tipo === 'muro' ? -1 : 1) - (b.tipo === 'muro' ? -1 : 1) || b.desv - a.desv);
  return { inclin, irregular: inclin.length > 0 };
}

// ESQUINAS ENTRANTES (E.030 Tabla N°12, Ip=0.90): la planta tiene esquinas entrantes cuyas
// dimensiones en AMBAS direcciones son > 20% de la dimensión total en planta. Se calcula con una
// rejilla de OCUPACION de las losas (robusto para plantas ortogonales): cada esquina del
// rectángulo envolvente que NO esté cubierta es un entrante; se mide su proyección en X (ax) y en
// Y (ay) y se marca si ax>0,20·Lx Y ay>0,20·Ly. (Aberturas interiores las cubre Diafragma.)
function calcEsquinasIrreg(elementos) {
  const byNivel = {};
  (elementos || []).forEach(e => { if (e.tipo === 'losa' && (e.pts || []).length >= 3) (byNivel[e.nivel] = byNivel[e.nivel] || []).push(e.pts); });
  const niveles = Object.keys(byNivel).map(Number).sort((a, b) => a - b);
  if (!niveles.length) return { evaluado: false, filas: [], irregular: false };
  const pip = (x, y, poly) => {
    let dentro = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  };
  const evalNivel = (polys) => {
    const todos = polys.flat();
    const xs = [...new Set(todos.map(p => Math.round(p.x * 1000) / 1000))].sort((a, b) => a - b);
    const ys = [...new Set(todos.map(p => Math.round(p.y * 1000) / 1000))].sort((a, b) => a - b);
    if (xs.length < 2 || ys.length < 2) return null;
    const Lx = xs[xs.length - 1] - xs[0], Ly = ys[ys.length - 1] - ys[0];
    const nx = xs.length - 1, ny = ys.length - 1;
    const occ = [];
    for (let i = 0; i < nx; i++) { occ[i] = []; for (let j = 0; j < ny; j++) { const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2; occ[i][j] = polys.some(pl => pip(cx, cy, pl)); } }
    const corners = [
      { ix: 0, iy: 0, dx: 1, dy: 1, lbl: 'inf-izq' },
      { ix: nx - 1, iy: 0, dx: -1, dy: 1, lbl: 'inf-der' },
      { ix: 0, iy: ny - 1, dx: 1, dy: -1, lbl: 'sup-izq' },
      { ix: nx - 1, iy: ny - 1, dx: -1, dy: -1, lbl: 'sup-der' },
    ];
    let peor = null;
    for (const c of corners) {
      if (occ[c.ix][c.iy]) continue;                 // esquina cubierta -> no hay entrante aquí
      let ax = 0; for (let i = c.ix; i >= 0 && i < nx && !occ[i][c.iy]; i += c.dx) ax += xs[i + 1] - xs[i];
      let ay = 0; for (let j = c.iy; j >= 0 && j < ny && !occ[c.ix][j]; j += c.dy) ay += ys[j + 1] - ys[j];
      const rx = Lx > 0 ? ax / Lx : 0, ry = Ly > 0 ? ay / Ly : 0;
      const cand = { lbl: c.lbl, ax, ay, rx, ry, viola: rx > 0.20 && ry > 0.20 };
      if (!peor || (rx + ry) > (peor.rx + peor.ry)) peor = cand;
    }
    return { Lx, Ly, peor };
  };
  const filas = niveles.map(k => { const r = evalNivel(byNivel[k]); return r ? { nivel: k, ...r } : null; }).filter(Boolean);
  return { evaluado: true, filas, irregular: filas.some(f => f.peor && f.peor.viola) };
}

// Grafico del espectro de diseno: Sa-T para X (azul) e Y (rojo punteado), con
// las plataformas TP/TL marcadas. Curva muestreada fina para que se vea suave.
function SvgEspectroDiseno({ datos, width = 720 }) {
  const height = 330;
  const M = { l: 56, r: 18, t: 20, b: 38 };
  if (!datos.valido) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center bg-black/30 rounded-xl border border-dashed border-amber-500/30 text-amber-300/90 text-[11px] font-bold px-6 text-center">
        El suelo {datos.suelo.id} no está tabulado para la {datos.zona.nombre} (requiere estudio de sitio EMS). Elige otra combinación zona/suelo.
      </div>
    );
  }
  const { Z, U, S, TP, TL, Rx, Ry, g } = datos;
  const tMax = Math.min(10, Math.max(3.5, TL * 1.3));
  const sa = (t, R) => Z * U * cFactorE030(t, TP, TL) * S * g / R;
  const N = 260;
  const serieX = [], serieY = [];
  for (let i = 0; i <= N; i++) { const t = (tMax * i) / N; serieX.push([t, sa(t, Rx)]); serieY.push([t, sa(t, Ry)]); }
  const saTop = Math.max(0.01, ...serieX.map(p => p[1]), ...serieY.map(p => p[1])) * 1.12;
  const px = t => M.l + (t / tMax) * (width - M.l - M.r);
  const py = v => height - M.b - (v / saTop) * (height - M.t - M.b);
  const path = a => a.map(([t, v], i) => `${i ? 'L' : 'M'} ${px(t).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const ticksY = 5, ticksT = Math.ceil(tMax / 0.5);
  const colX = '#60a5fa', colY = '#f87171';
  const igualRxy = Math.abs(Rx - Ry) < 1e-6;
  return (
    <svg width={width} height={height} className="bg-black/30 rounded-xl border border-white/10">
      {/* grilla horizontal + etiquetas de Sa */}
      {Array.from({ length: ticksY + 1 }, (_, i) => {
        const v = (saTop / 1.12) * (i / ticksY);
        return (
          <g key={`gy${i}`}>
            <line x1={M.l} y1={py(v)} x2={width - M.r} y2={py(v)} stroke="rgba(148,163,184,0.10)" strokeWidth="1" />
            <text x={M.l - 6} y={py(v) + 3} textAnchor="end" fontSize="8.5" fill="#64748b">{v.toFixed(2)}</text>
          </g>
        );
      })}
      {/* grilla vertical + etiquetas de T */}
      {Array.from({ length: ticksT + 1 }, (_, i) => {
        const t = i * 0.5; if (t > tMax + 1e-6) return null;
        return (
          <g key={`gx${i}`}>
            <line x1={px(t)} y1={M.t} x2={px(t)} y2={height - M.b} stroke="rgba(148,163,184,0.07)" strokeWidth="1" />
            <text x={px(t)} y={height - M.b + 14} textAnchor="middle" fontSize="8.5" fill="#64748b">{t.toFixed(1)}</text>
          </g>
        );
      })}
      {/* marcadores TP y TL */}
      {[['TP', TP], ['TL', TL]].filter(([, v]) => v <= tMax).map(([lbl, v]) => (
        <g key={lbl}>
          <line x1={px(v)} y1={M.t} x2={px(v)} y2={height - M.b} stroke="rgba(251,191,36,0.5)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={px(v) + 3} y={M.t + 9} fontSize="8.5" fill="#fbbf24" fontWeight="700">{lbl}={v}</text>
        </g>
      ))}
      {/* ejes */}
      <line x1={M.l} y1={height - M.b} x2={width - M.r} y2={height - M.b} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
      <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
      {/* curvas */}
      <path d={path(serieY)} fill="none" stroke={colY} strokeWidth="2" strokeDasharray="6 4" opacity={igualRxy ? 0.55 : 0.95} />
      <path d={path(serieX)} fill="none" stroke={colX} strokeWidth="2.4" />
      {/* leyenda */}
      <g transform={`translate(${width - M.r - 150}, ${M.t + 4})`}>
        <rect x="0" y="0" width="150" height={igualRxy ? 18 : 32} rx="5" fill="rgba(2,6,23,0.7)" stroke="rgba(255,255,255,0.08)" />
        <line x1="8" y1="9" x2="26" y2="9" stroke={colX} strokeWidth="2.4" />
        <text x="31" y="12" fontSize="8.5" fill="#bae6fd">Sa X · R={Rx.toFixed(2)}</text>
        {!igualRxy && (<><line x1="8" y1="24" x2="26" y2="24" stroke={colY} strokeWidth="2" strokeDasharray="6 4" />
          <text x="31" y="27" fontSize="8.5" fill="#fecaca">Sa Y · R={Ry.toFixed(2)}</text></>)}
      </g>
      <text x={(M.l + width - M.r) / 2} y={height - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">Periodo T (s)</text>
      <text x={14} y={M.t + 4} fontSize="9" fill="#94a3b8" transform={`rotate(-90 14 ${(M.t + height - M.b) / 2})`} textAnchor="middle">Sa {g === 1 ? '(Sa/g)' : '(m/s²)'}</text>
    </svg>
  );
}

// Grafico del espectro para la MEMORIA (hoja A4 BLANCA): una direccion, tinta
// oscura sobre fondo blanco, estilo de la hoja del usuario (ESPECTRO X-X / Y-Y).
function SvgEspectroDoc({ datos, dir = 'x', width = 330 }) {
  const height = 196;
  const M = { l: 40, r: 10, t: 12, b: 28 };
  if (!datos.valido) return null;
  const { Z, U, S, TP, TL, g } = datos;
  const R = dir === 'y' ? datos.Ry : datos.Rx;
  const color = dir === 'y' ? '#c00000' : '#1f4e79';
  const tMax = 10;   // como la hoja del usuario (eje hasta 10 s)
  const sa = t => Z * U * cFactorE030(t, TP, TL) * S * g / R;
  const N = 300, serie = [];
  for (let i = 0; i <= N; i++) { const t = (tMax * i) / N; serie.push([t, sa(t)]); }
  const saTop = Math.max(...serie.map(p => p[1]), 0.01) * 1.1;
  const px = t => M.l + (t / tMax) * (width - M.l - M.r);
  const py = v => height - M.b - (v / saTop) * (height - M.t - M.b);
  const path = serie.map(([t, v], i) => `${i ? 'L' : 'M'} ${px(t).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  const cy = (M.t + height - M.b) / 2;
  return (
    <svg width={width} height={height} style={{ background: '#fff', border: '0.5pt solid #999' }}>
      <text x={width / 2} y={9} textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="#222">{`ESPECTRO DE PSEUDO - ACELERACIONES ${dir.toUpperCase()}-${dir.toUpperCase()}`}</text>
      {Array.from({ length: 5 }, (_, i) => {
        const v = (saTop / 1.1) * (i / 4);
        return <g key={`y${i}`}><line x1={M.l} y1={py(v)} x2={width - M.r} y2={py(v)} stroke="#e3e3e3" strokeWidth="0.5" /><text x={M.l - 3} y={py(v) + 2.5} textAnchor="end" fontSize="6" fill="#444">{v.toFixed(2)}</text></g>;
      })}
      {[0, 2, 4, 6, 8, 10].map(t => <g key={`x${t}`}><line x1={px(t)} y1={M.t} x2={px(t)} y2={height - M.b} stroke="#eee" strokeWidth="0.5" /><text x={px(t)} y={height - M.b + 10} textAnchor="middle" fontSize="6" fill="#444">{t.toFixed(2)}</text></g>)}
      <line x1={px(TP)} y1={M.t} x2={px(TP)} y2={height - M.b} stroke="#c00000" strokeWidth="0.7" strokeDasharray="3 2" />
      <line x1={px(TL)} y1={M.t} x2={px(TL)} y2={height - M.b} stroke="#2e7d32" strokeWidth="0.7" strokeDasharray="3 2" />
      <line x1={M.l} y1={height - M.b} x2={width - M.r} y2={height - M.b} stroke="#333" strokeWidth="0.8" />
      <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b} stroke="#333" strokeWidth="0.8" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
      <text x={(M.l + width - M.r) / 2} y={height - 2} textAnchor="middle" fontSize="6.5" fill="#333">PERIODO T (s)</text>
      <text x={9} y={cy} textAnchor="middle" fontSize="6.5" fill="#333" transform={`rotate(-90 9 ${cy})`}>{`SA DIR ${dir.toUpperCase()}-${dir.toUpperCase()}`}</text>
    </svg>
  );
}

// Documento LaTeX de la memoria del espectro de respuesta (E.030-2026):
// tablas de factores + formulas + grafico pgfplots + tabla T-Sa (longtable).
function buildMemoriaEspectro(diseno, { encabezadoIzq = '', encabezadoDer = '' } = {}, proyecto = '') {
  const d = calcEspectroDiseno(diseno);
  const titulo = 'CALCULO DE ESPECTRO DE PSEUDO-ACELERACIONES (NORMA E.030-2026)';
  const esc = s => String(s).replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/_/g, '\\_');
  if (!d.valido) {
    return { titulo, valido: false, latex: `% El suelo ${d.suelo.id} no esta tabulado para la ${d.zona.nombre} (requiere EMS).` };
  }
  const f = (x, n = 2) => Number(x).toFixed(n);
  const lista = (arr, base) => base.filter(it => (arr || []).includes(it.id)).map(it => `${esc(it.nombre)} (${it.f})`).join(', ') || 'ninguna';
  const gTxt = d.g === 1 ? '1' : '9.81';
  const uni = d.g === 1 ? '$S_a/g$' : 'm/s$^2$';
  const filasSa = d.puntos.map(p => `${p.t} & ${p.c.toFixed(4)} & ${p.sax.toFixed(5)} & ${p.say.toFixed(5)} \\\\`).join('\n');
  const coordsX = d.puntos.map(p => `(${p.t},${p.sax.toFixed(5)})`).join(' ');
  const coordsY = d.puntos.map(p => `(${p.t},${p.say.toFixed(5)})`).join(' ');
  const latex = `% Memoria del espectro de respuesta E.030-2026 — generada por ETABS API + IA
\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[spanish]{babel}
\\usepackage[margin=2.2cm]{geometry}
\\usepackage{amsmath,booktabs,longtable,xcolor,fancyhdr,lastpage,pgfplots}
\\pgfplotsset{compat=1.17}
\\pagestyle{fancy}\\fancyhf{}
\\lhead{\\small\\textbf{${esc(encabezadoIzq)}}}
\\rhead{\\small ${esc(encabezadoDer)}}
\\cfoot{\\small P\\'agina \\thepage\\ de \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0.6pt}
\\begin{document}
\\begin{center}{\\large\\textbf{ANEXO: ${titulo}}}\\\\[3pt]
\\textbf{Proyecto:} ${esc(proyecto) || '---'}\\end{center}

\\section*{1. Factores s\\'ismicos}
\\begin{tabular}{ll}
\\toprule
Factor de zona ($Z$) & ${esc(d.zona.nombre)}, \\; $Z=${d.Z}$ \\\\
Factor de suelo ($S$) & ${esc(d.suelo.nombre)}, \\; $S=${d.S}$, \\; $T_P=${d.TP}$ s, \\; $T_L=${d.TL}$ s \\\\
Factor de uso ($U$) & ${esc(d.uso.nombre)}, \\; $U=${d.U}$ \\\\
Sistema X-X ($R_0$) & ${esc(d.sisX.nombre)}, \\; $R_0=${d.R0x}$ \\\\
Sistema Y-Y ($R_0$) & ${esc(d.sisY.nombre)}, \\; $R_0=${d.R0y}$ \\\\
Irregularidad en altura X / Y & ${lista(diseno.iaX, IRREG_ALTURA)} \\; / \\; ${lista(diseno.iaY, IRREG_ALTURA)} \\\\
Irregularidad en planta X / Y & ${lista(diseno.ipX, IRREG_PLANTA)} \\; / \\; ${lista(diseno.ipY, IRREG_PLANTA)} \\\\
\\bottomrule
\\end{tabular}

\\section*{2. Coeficiente de reducci\\'on y resumen}
\\[ R = R_0\\cdot I_a\\cdot I_p \\qquad R_{x}=${d.R0x}\\times${f(d.Iax)}\\times${f(d.Ipx)}=${f(d.Rx)} \\qquad R_{y}=${d.R0y}\\times${f(d.Iay)}\\times${f(d.Ipy)}=${f(d.Ry)} \\]
\\[ S_a = \\frac{Z\\,U\\,C\\,S}{R}\\,g \\qquad C=\\begin{cases} 1+7.5\\,T/T_P & T<0.2\\,T_P\\\\[2pt] 2.5 & 0.2\\,T_P\\le T\\le T_P \\\\[2pt] 2.5\\,(T_P/T) & T_P<T<T_L \\\\[2pt] 2.5\\,T_P T_L/T^2 & T>T_L \\end{cases} \\]
con $g=${gTxt}$ (${uni}).

\\section*{3. Espectro de dise\\~no}
\\begin{center}
\\begin{tikzpicture}
\\begin{axis}[width=13cm,height=7cm,xlabel={Periodo $T$ (s)},ylabel={$S_a$ (${uni})},xmin=0,ymin=0,legend pos=north east,grid=both,grid style={gray!18}]
\\addplot[blue,very thick] coordinates { ${coordsX} }; \\addlegendentry{$S_a$ X-X}
\\addplot[red,very thick,dashed] coordinates { ${coordsY} }; \\addlegendentry{$S_a$ Y-Y}
\\end{axis}
\\end{tikzpicture}
\\end{center}

\\section*{4. Tabla $T$ -- $S_a$}
\\begin{center}
\\begin{longtable}{rrrr}
\\toprule $T$ (s) & $C$ & $S_a$ X-X & $S_a$ Y-Y \\\\ \\midrule \\endhead
${filasSa}
\\bottomrule
\\end{longtable}
\\end{center}
\\end{document}`;
  return { titulo, valido: true, latex };
}

// Curva del espectro E.030: Sa = Z*U*C*S/R*g con la rama corta de la norma.
function SvgEspectro({ z, u, s, tp, tl, r, width = 340 }) {
  const Z = Number(z) || 0.45, U = Number(u) || 1, S = Number(s) || 1, TP = Number(tp) || 0.6, TL = Number(tl) || 2, R = Number(r) || 8;
  const G = 9.80665;
  const cDe = t => {
    if (t < 0.2 * TP) return 1 + 7.5 * t / TP;
    if (t < TP) return 2.5;
    if (t < TL) return 2.5 * TP / t;
    return 2.5 * TP * TL / (t * t);
  };
  const tMax = Math.min(Math.max(TL * 1.5, 3), 10);
  const pts = [];
  for (let t = 0; t <= tMax + 1e-9; t += tMax / 120) pts.push([t, Z * U * cDe(t) * S / R * G]);
  const meseta = Z * U * 2.5 * S / R * G;
  const height = 190;
  const M = { l: 40, r: 12, t: 16, b: 26 };
  const px = t => M.l + (t / tMax) * (width - M.l - M.r);
  const py = v => height - M.b - (v / (meseta * 1.12)) * (height - M.t - M.b);
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'} ${px(t).toFixed(1)} ${py(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
      <line x1={M.l} y1={height - M.b} x2={width - M.r} y2={height - M.b} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
      <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b} stroke="rgba(148,163,184,0.5)" strokeWidth="1" />
      <line x1={px(TP)} y1={M.t} x2={px(TP)} y2={height - M.b} stroke="rgba(251,191,36,0.45)" strokeWidth="1" strokeDasharray="4 4" />
      <line x1={px(TL)} y1={M.t} x2={px(TL)} y2={height - M.b} stroke="rgba(251,191,36,0.45)" strokeWidth="1" strokeDasharray="4 4" />
      <text x={px(TP)} y={height - M.b + 12} textAnchor="middle" fontSize="8" fill="#fbbf24">TP={TP}</text>
      <text x={px(TL)} y={height - M.b + 12} textAnchor="middle" fontSize="8" fill="#fbbf24">TL={TL}</text>
      <line x1={M.l} y1={py(meseta)} x2={width - M.r} y2={py(meseta)} stroke="rgba(59,130,246,0.3)" strokeWidth="1" strokeDasharray="2 4" />
      <text x={M.l + 4} y={py(meseta) - 4} fontSize="8" fill="#93c5fd">Sa meseta = {meseta.toFixed(3)} m/s²</text>
      <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" />
      <text x={(M.l + width - M.r) / 2} y={height - 4} textAnchor="middle" fontSize="8" fill="#64748b">T (s)</text>
      <text x={10} y={M.t + 8} fontSize="8" fill="#64748b">Sa</text>
      <text x={width - M.r} y={height - M.b + 12} textAnchor="end" fontSize="8" fill="#64748b">{tMax.toFixed(0)}</text>
    </svg>
  );
}

// Grafico de derivas por piso (v3.0): barras horizontales por caso/direccion
// con la linea del limite E.030. filas: [{piso, caso, direccion, deriva, cumple}].
function SvgDerivas({ filas, limite, width = 520 }) {
  if (!filas || !filas.length) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-3">Sin filas de derivas.</div>;
  }
  const pisos = [...new Set(filas.map(f => f.piso))];
  const series = [...new Set(filas.map(f => `${f.caso} ${f.direccion}`))];
  const colores = ['#3b82f6', '#34d399', '#fbbf24', '#c084fc'];
  const maxV = Math.max(limite * 1.25, ...filas.map(f => f.deriva));
  const filaH = Math.max(12, series.length * 7 + 6);
  const M = { l: 64, r: 14, t: 8, b: 30 };
  const height = M.t + pisos.length * filaH + M.b;
  const px = v => M.l + (v / maxV) * (width - M.l - M.r);
  return (
    <svg width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
      {pisos.map((p, i) => (
        <g key={p}>
          <text x={M.l - 6} y={M.t + i * filaH + filaH / 2 + 3} textAnchor="end" fontSize="8.5" fill="#94a3b8" fontWeight="700">{p}</text>
          {filas.filter(f => f.piso === p).map((f, j) => {
            const clave = `${f.caso} ${f.direccion}`;
            const k = series.indexOf(clave);
            const y = M.t + i * filaH + 3 + k * 7;
            return <rect key={j} x={M.l} y={y} width={Math.max(1, px(f.deriva) - M.l)} height="5" rx="1"
              fill={f.cumple ? colores[k % colores.length] : '#f87171'} opacity="0.9" />;
          })}
        </g>
      ))}
      <line x1={px(limite)} y1={M.t} x2={px(limite)} y2={height - M.b + 4} stroke="#f87171" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={px(limite)} y={height - M.b + 14} textAnchor="middle" fontSize="8" fill="#fca5a5" fontWeight="700">limite {limite}</text>
      <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b + 4} stroke="rgba(148,163,184,0.4)" strokeWidth="1" />
      {series.map((s, k) => (
        <g key={s}>
          <rect x={M.l + 4 + k * 92} y={height - 12} width="7" height="5" fill={colores[k % colores.length]} />
          <text x={M.l + 14 + k * 92} y={height - 7} fontSize="8" fill="#94a3b8">{s}</text>
        </g>
      ))}
    </svg>
  );
}

// Desplazamientos maximos por piso (Story Response de ETABS): por cada caso un
// perfil con el piso en el eje vertical (de Base al tope) y el desplazamiento en
// mm en el horizontal; Ux en azul, Uy en rojo punteado (como ETABS: X azul, Y rojo).
function SvgDesplazamientos({ desplaz, width = 248 }) {
  const porCaso = (desplaz && desplaz.por_caso) || {};
  const casos = Object.keys(porCaso);
  if (!casos.length) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-3">Sin desplazamientos (corre el analisis y vuelve a leer resultados).</div>;
  }
  const baseZ = Number(desplaz.base_z) || 0;
  const maxX = Math.max(1, ...casos.flatMap(c => porCaso[c].flatMap(f => [Number(f.ux) || 0, Number(f.uy) || 0])));
  const colUx = '#60a5fa', colUy = '#f87171';
  const panel = (caso) => {
    const filas = porCaso[caso] || [];
    const pts = [{ elev: baseZ, ux: 0, uy: 0, piso: 'Base' }, ...filas];
    const elevs = pts.map(p => Number(p.elev) || 0);
    const minE = Math.min(...elevs), maxE = Math.max(...elevs);
    const M = { l: 42, r: 12, t: 18, b: 30 };
    const height = 212;
    const px = v => M.l + ((Number(v) || 0) / maxX) * (width - M.l - M.r);
    const py = e => height - M.b - (((Number(e) || 0) - minE) / ((maxE - minE) || 1)) * (height - M.t - M.b);
    const linea = key => pts.map(p => `${px(p[key]).toFixed(1)},${py(p.elev).toFixed(1)}`).join(' ');
    const top = filas.length ? filas[filas.length - 1] : null;
    return (
      <svg key={caso} width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
        <text x={M.l} y={12} fontSize="9.5" fill="#a5f3fc" fontWeight="700">{caso}</text>
        {pts.map((p, i) => (
          <g key={i}>
            <line x1={M.l} y1={py(p.elev)} x2={width - M.r} y2={py(p.elev)} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
            <text x={M.l - 4} y={py(p.elev) + 3} textAnchor="end" fontSize="7.5" fill="#94a3b8">{p.piso}</text>
          </g>
        ))}
        <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b} stroke="rgba(148,163,184,0.45)" strokeWidth="1" />
        <polyline points={linea('uy')} fill="none" stroke={colUy} strokeWidth="1.6" strokeDasharray="5 3" />
        <polyline points={linea('ux')} fill="none" stroke={colUx} strokeWidth="1.9" />
        {pts.map((p, i) => <circle key={'x' + i} cx={px(p.ux)} cy={py(p.elev)} r="2.3" fill={colUx} />)}
        {pts.map((p, i) => <circle key={'y' + i} cx={px(p.uy)} cy={py(p.elev)} r="2" fill={colUy} />)}
        {top && <text x={Math.min(width - M.r, px(Math.max(top.ux, top.uy)) + 4)} y={py(top.elev) - 3} textAnchor="end" fontSize="8" fill="#cbd5e1" fontWeight="700">{Math.max(Number(top.ux), Number(top.uy)).toFixed(1)} mm</text>}
        <text x={M.l} y={height - 16} textAnchor="middle" fontSize="7" fill="#64748b">0</text>
        <text x={width - M.r} y={height - 16} textAnchor="end" fontSize="7" fill="#64748b">{maxX.toFixed(0)}</text>
        <text x={(M.l + width - M.r) / 2} y={height - 5} textAnchor="middle" fontSize="7.5" fill="#64748b">Desplazamiento (mm)</text>
      </svg>
    );
  };
  return (
    <div>
      <div className="flex flex-wrap gap-3">{casos.map(panel)}</div>
      <div className="flex gap-4 mt-2 text-[8.5px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: colUx }} />Ux · direccion X</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: colUy }} />Uy · direccion Y</span>
      </div>
    </div>
  );
}

// Derivas de piso estilo "Maximum Story Drifts" de ETABS: por cada caso/combo un
// perfil con el piso en el eje vertical y la deriva (×10⁻³) en el horizontal;
// drift X en azul, drift Y en rojo punteado, mas la linea vertical del limite E.030.
function SvgDerivasPerfil({ perfil, baseZ = 0, limite = 0.007, width = 248 }) {
  const porCaso = perfil || {};
  const casos = Object.keys(porCaso);
  if (!casos.length) {
    return <div className="text-[10px] text-slate-500 border border-dashed border-white/10 rounded-lg p-3">Sin derivas (corre el analisis y vuelve a leer resultados).</div>;
  }
  const colDx = '#60a5fa', colDy = '#f87171';
  const maxX = Math.max(limite * 1.2, 1e-9, ...casos.flatMap(c => porCaso[c].flatMap(f => [Number(f.dx) || 0, Number(f.dy) || 0])));
  const e3 = v => (v * 1000).toFixed(1);  // mostrar en x10^-3 como ETABS
  const panel = (caso) => {
    const filas = porCaso[caso] || [];
    const pts = [{ elev: baseZ, dx: 0, dy: 0, piso: 'Base' }, ...filas];
    const elevs = pts.map(p => Number(p.elev) || 0);
    const minE = Math.min(...elevs), maxE = Math.max(...elevs);
    const M = { l: 42, r: 12, t: 18, b: 30 };
    const height = 212;
    const px = v => M.l + ((Number(v) || 0) / maxX) * (width - M.l - M.r);
    const py = e => height - M.b - (((Number(e) || 0) - minE) / ((maxE - minE) || 1)) * (height - M.t - M.b);
    const linea = key => pts.map(p => `${px(p[key]).toFixed(1)},${py(p.elev).toFixed(1)}`).join(' ');
    const peor = filas.reduce((m, f) => Math.max(m, Number(f.dx) || 0, Number(f.dy) || 0), 0);
    return (
      <svg key={caso} width={width} height={height} className="bg-black/30 rounded-lg border border-white/10">
        <text x={M.l} y={12} fontSize="9.5" fill="#a5f3fc" fontWeight="700">{caso}</text>
        {pts.map((p, i) => (
          <g key={i}>
            <line x1={M.l} y1={py(p.elev)} x2={width - M.r} y2={py(p.elev)} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
            <text x={M.l - 4} y={py(p.elev) + 3} textAnchor="end" fontSize="7.5" fill="#94a3b8">{p.piso}</text>
          </g>
        ))}
        <line x1={M.l} y1={M.t} x2={M.l} y2={height - M.b} stroke="rgba(148,163,184,0.45)" strokeWidth="1" />
        {limite > 0 && limite <= maxX && (
          <g>
            <line x1={px(limite)} y1={M.t} x2={px(limite)} y2={height - M.b} stroke="#fbbf24" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <text x={px(limite)} y={M.t - 1} textAnchor="middle" fontSize="6.5" fill="#fcd34d">lim {e3(limite)}</text>
          </g>
        )}
        <polyline points={linea('dy')} fill="none" stroke={colDy} strokeWidth="1.6" strokeDasharray="5 3" />
        <polyline points={linea('dx')} fill="none" stroke={colDx} strokeWidth="1.9" />
        {pts.map((p, i) => <circle key={'x' + i} cx={px(p.dx)} cy={py(p.elev)} r="2.3" fill={colDx} />)}
        {pts.map((p, i) => <circle key={'y' + i} cx={px(p.dy)} cy={py(p.elev)} r="2" fill={colDy} />)}
        {peor > 0 && <text x={width - M.r} y={M.t - 1} textAnchor="end" fontSize="7.5" fill={peor > limite ? '#fca5a5' : '#86efac'} fontWeight="700">{e3(peor)}e-3</text>}
        <text x={M.l} y={height - 16} textAnchor="middle" fontSize="7" fill="#64748b">0</text>
        <text x={width - M.r} y={height - 16} textAnchor="end" fontSize="7" fill="#64748b">{e3(maxX)}</text>
        <text x={(M.l + width - M.r) / 2} y={height - 5} textAnchor="middle" fontSize="7.5" fill="#64748b">Deriva (×10⁻³)</text>
      </svg>
    );
  };
  return (
    <div>
      <div className="flex flex-wrap gap-3">{casos.map(panel)}</div>
      <div className="flex gap-4 mt-2 text-[8.5px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: colDx }} />Deriva X</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: colDy }} />Deriva Y</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0 border-t border-dashed" style={{ borderColor: '#fbbf24' }} />limite {limite}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem('etabs_ai_config_final');
    const defaults = {
      aiProvider: 'gemini',
      geminiApiKeys: '',
      openaiApiKeys: '',
      anthropicApiKeys: '',
      geminiModel: 'gemini-2.5-flash',
      openaiModel: 'gpt-4.1-mini',
      anthropicModel: 'claude-fable-5',
      customGeminiModel: '',
      customOpenaiModel: '',
      customAnthropicModel: '',
      pythonUrl: 'http://127.0.0.1:8000',
      documentationContext: DEFAULT_API_CONTEXT,
      strictMode: true,
      agentMode: false
    };

    if (!saved) return defaults;

    try {
      const parsed = JSON.parse(saved);
      return { ...defaults, ...parsed, documentationContext: parsed.documentationContext || DEFAULT_API_CONTEXT };
    } catch {
      return defaults;
    }
  });

  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Listo, Neo. App final corregida: puente React-Python alineado, test de modelos IA y reglas ETABS reforzadas.' }
  ]);
  const [pythonCode, setPythonCode] = useState(DEFAULT_CODE);
  const [chatInput, setChatInput] = useState('');
  const [executionOutput, setExecutionOutput] = useState('');
  const [lastError, setLastError] = useState('');
  const [sessionMode, setSessionMode] = useState('attach_or_start_new_model');
  const [modelFilePath, setModelFilePath] = useState('');
  const [selectedUnits, setSelectedUnits] = useState('8');
  const [visibleEtabs, setVisibleEtabs] = useState(true);
  const [saveBeforeRun, setSaveBeforeRun] = useState(false);
  const [currentKeyIndex, setCurrentKeyIndex] = useState({ gemini: 0, openai: 0, anthropic: 0 });
  // Modo agente (v3.1.0): bucle con herramientas (tool-calling). El catalogo de
  // tools se lee del servidor; la ejecucion en ETABS pide confirmacion al usuario.
  const [aiTools, setAiTools] = useState([]);
  const [pendingTool, setPendingTool] = useState(null);   // {name, arguments} para la tarjeta
  const pendingToolRef = useRef(null);                    // resolver de la confirmacion
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  // Panel lateral derecho (IA / Biblioteca) colapsable, para ganar area de trabajo.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('etabs_sidebar_open') !== '0');
  useEffect(() => { localStorage.setItem('etabs_sidebar_open', sidebarOpen ? '1' : '0'); }, [sidebarOpen]);
  const [terminalOpen, setTerminalOpen] = useState(() => localStorage.getItem('etabs_terminal_open') !== '0');
  useEffect(() => { localStorage.setItem('etabs_terminal_open', terminalOpen ? '1' : '0'); }, [terminalOpen]);
  // Area principal: pestania "Flujo de trabajo" (protagonista) o "Codigo".
  const [mainTab, setMainTab] = useState('flujo');
  // Proyecto activo (multi-proyecto): el progreso de pasos se guarda POR proyecto.
  const [proyecto, setProyecto] = useState(() => localStorage.getItem('etabs_proyecto') || 'Proyecto 1');
  // Pasos completados (persistido por proyecto): se marca al ejecutar una herramienta.
  const [stepsDone, setStepsDone] = useState(() => {
    try { return JSON.parse(localStorage.getItem('etabs_steps_done__' + (localStorage.getItem('etabs_proyecto') || 'Proyecto 1')) || '{}'); } catch { return {}; }
  });
  // Instancias de ETABS abiertas y la seleccionada (PID). 0 = la registrada.
  const [instancias, setInstancias] = useState([]);
  const [instanciaPid, setInstanciaPid] = useState(0);
  const [diagData, setDiagData] = useState(null);
  const [diagOpen, setDiagOpen] = useState(false);
  // Materiales detectados en el modelo (de diagnosticar / leer) para sugerirlos
  // en los formularios de secciones/losas/muros y poder REUSARLOS.
  const [materialesDisponibles, setMaterialesDisponibles] = useState({ concretos: [], aceros: [] });
  const [openStep, setOpenStep] = useState('');
  // Zoom y pan del diagrama del flujo (lienzo 1820x640 transformado dentro de un viewport).
  const [flowZoom, setFlowZoom] = useState(1);
  const [flowPan, setFlowPan] = useState({ x: 0, y: 0 });
  const [flowDragging, setFlowDragging] = useState(false);
  const flowViewportRef = useRef(null);
  const flowDragRef = useRef(null);
  const flowJustDragged = useRef(false);
  const [activePanel, setActivePanel] = useState('tools');
  const [matParams, setMatParams] = useState({ nombre: 'CONC_FC210', fc: 210, peso: 2400 });
  const [vigaParams, setVigaParams] = useState({ nombre: 'V30X60', material: 'CONC_FC210', baseCm: 30, alturaCm: 60, matRefuerzo: 'A615Gr60', recubCm: 4 });
  const [colParams, setColParams] = useState({ nombre: 'C40X40', material: 'CONC_FC210', baseCm: 40, alturaCm: 40, matRefuerzo: 'A615Gr60', recubCm: 4, barras3: 3, barras2: 3, barraLong: '20', barraEstribo: '10', espEstriboCm: 15 });
  const [drawParams, setDrawParams] = useState({ seccionColumna: 'C40X40', seccionViga: 'V30X60', vigasX: true, vigasY: true });
  const [apoyoEmpotrado, setApoyoEmpotrado] = useState(true);
  const [patParams, setPatParams] = useState({ incluirCE: true });
  const [comboParams, setComboParams] = useState({ incluirCE: true, incluirSismo: true, casoSismoX: 'CSX', casoSismoY: 'CSY', factorDerivaX: 4.335, factorDerivaY: 4.335 });
  // Losas (parametros del modelo de clase del usuario) y cargas (kgf, E.030).
  const [losaMacizaParams, setLosaMacizaParams] = useState({ nombre: 'LM_H20', material: 'CONC_FC210', espesorCm: 20 });
  const [losa1dParams, setLosa1dParams] = useState({ nombre: 'LA1D_H25', material: 'CONC_FC210', peralteCm: 25, losaCm: 5, viguetaSupCm: 10, viguetaInfCm: 10, separacionCm: 40, paralelo: 1 });
  const [losa2dParams, setLosa2dParams] = useState({ nombre: 'LA2D_H20', material: 'CONC_FC210', peralteCm: 20, losaCm: 5, nervioSupCm: 10, nervioInfCm: 10, separacionXCm: 50, separacionYCm: 50 });
  const [drawSlabParams, setDrawSlabParams] = useState({ seccionLosa: 'LA1D_H25' });
  const [aceroParams, setAceroParams] = useState({ nombre: 'ACERO_FY4200', fy: 4200, fu: 6300 });
  const [muroDefParams, setMuroDefParams] = useState({ nombre: 'MURO_E30', material: 'CONC_FC210', espesorCm: 30 });
  const [muroDrawParams, setMuroDrawParams] = useState({ propiedad: 'MURO_E30', soloPerimetro: true, soloPrimerNivel: true });
  const [muroLoadParams, setMuroLoadParams] = useState({ propiedad: 'MURO_E30', patron: 'CE', gammaSuelo: 1800, ka: 0.33, alturaM: 0, presionDirecta: 0 });
  const [beamLoadParams, setBeamLoadParams] = useState({ cargaCM: 280, cargaCV: 0, filtroSeccion: '', reemplazar: true });
  const [slabLoadParams, setSlabLoadParams] = useState({ cargaCM: 300, cargaCV: 250, filtroPropiedad: '', reemplazar: true });
  const [espectroParams, setEspectroParams] = useState({ nombreFuncion: 'E030_XY', z: 0.45, u: 1.0, s: 1.05, tp: 0.6, tl: 2.0, r: 8, casoModal: 'Modal', modosMin: 3, modosMax: 17, masaCM: 1.0, masaCV: 0.5, casoX: 'CSX', casoY: 'CSY', sfX: 1.0, sfY: 1.0, orto30: true });
  // Mass Source: factores CM/CV se comparten con el espectro (espectroParams); aqui solo
  // el patron de cada uno y si se incluye el peso propio de los elementos.
  const [massSourceParams, setMassSourceParams] = useState({ incluirElementos: false, patronCM: 'CM', patronCV: 'CV' });
  const [automeshParams, setAutomeshParams] = useState({ soloTipo: 'todas', maxSize: '0.7', atGrids: false });   // todas | losas | muros
  const [diafragmaParams, setDiafragmaParams] = useState({ nombre: 'D1-rigido', semiRigido: false, alcance: 'todos', pisos: '' });   // diafragma por punto; alcance: todos | especificos
  const [endOffsetParams, setEndOffsetParams] = useState({ tipo: 'todas', auto: true, rzFactor: '0.5', lenI: '0', lenJ: '0' });   // brazos rigidos viga/columna
  // RELEASE / liberacion de momentos en vigas; alcance: seleccion (de ETABS) | todas | seccion
  const [releaseParams, setReleaseParams] = useState({ alcance: 'seleccion', soloVigas: true, filtroSeccion: '', m3i: true, m3j: true, m2i: false, m2j: false, torsionJ: false });
  const [imgGridBusy, setImgGridBusy] = useState(false);   // detectando ejes desde imagen (IA visión)
  const [imgGridMsg, setImgGridMsg] = useState('');
  const [dxfState, setDxfState] = useState({ segments: null, layers: [], layerCounts: {}, capa: '(todas)', unidad: 'auto', msg: '' });   // importar ejes de CAD (DXF)
  // El CONCRETO definido (matParams) se usa POR DEFECTO como material de TODAS las
  // secciones (viga/columna/losas/muro). Si el usuario lo cambia luego, se propaga.
  // (Los efectos van DESPUES de declarar los states de los que dependen — lección TDZ.)
  useEffect(() => {
    const m = (matParams.nombre || '').trim();
    if (!m) return;
    const fix = p => (p.material === m ? p : { ...p, material: m });
    setVigaParams(fix); setColParams(fix); setLosaMacizaParams(fix);
    setLosa1dParams(fix); setLosa2dParams(fix); setMuroDefParams(fix);
  }, [matParams.nombre]);
  // El ACERO definido (aceroParams) se usa POR DEFECTO como material de refuerzo de
  // las secciones que lo llevan (viga y columna).
  useEffect(() => {
    const a = (aceroParams.nombre || '').trim();
    if (!a) return;
    const fix = p => (p.matRefuerzo === a ? p : { ...p, matRefuerzo: a });
    setVigaParams(fix); setColParams(fix);
  }, [aceroParams.nombre]);
  // El Espectro de Diseno (E.030-2026): parametros de la pestana, persistidos.
  const [disenoEspectro, setDisenoEspectro] = useState(() => {
    const base = { zona: 'Z4', suelo: 'S1', uso: 'C', sistemaX: 'ca', sistemaY: 'ca', iaX: [], iaY: [], ipX: [], ipY: [], adimensional: false };
    try { const g = localStorage.getItem('etabs_diseno_espectro'); return g ? { ...base, ...JSON.parse(g) } : base; } catch { return base; }
  });
  useEffect(() => { try { localStorage.setItem('etabs_diseno_espectro', JSON.stringify(disenoEspectro)); } catch { /* sin persistencia */ } }, [disenoEspectro]);
  // Resultado de la verificacion automatica de la irregularidad de MASA (paso verifirreg).
  const [verifMasa, setVerifMasa] = useState(null);  // {loading} | {error} | {filas, irregular}
  // Resultado de la verificacion automatica de la irregularidad TORSIONAL (X/Y).
  const [verifTorsion, setVerifTorsion] = useState(null);  // {loading} | {error} | {res}
  // Resultado de la verificacion automatica de RIGIDEZ / PISO BLANDO (X/Y).
  const [verifRigidez, setVerifRigidez] = useState(null);  // {loading} | {error} | {res}
  // Resultado de las verificaciones GEOMETRICAS (vertical + diafragma + no paralelos), de una
  // sola lectura de geometria. {loading} | {error} | {vertical, diafragma, noParalelo}
  const [verifGeom, setVerifGeom] = useState(null);
  // SISTEMA ESTRUCTURAL (Tabla N°8): % de cortante basal que toman los muros, por direccion.
  const [verifSistema, setVerifSistema] = useState(null);            // {loading}|{error}|{...frac}
  const [sisInput, setSisInput] = useState({ pctX: '', pctY: '' });  // % muros editable (auto o a mano)
  // Irregularidad abierta en su modal individual (clic en su nodo del diagrama). '' = ninguna.
  const [openIrreg, setOpenIrreg] = useState('');
  // VINCULO AUTOMATICO: "El Espectro de Diseño" (disenoEspectro) es la fuente de verdad.
  // El paso "Espectro" (funcion de ETABS) y el FACTOR DE DERIVA se calculan solos desde el:
  // R = R0*Ia*Ip por direccion; el espectro Y sale del X con SF = Rx/Ry (espectros distintos
  // X/Y); factor de deriva = (0.85 irregular / 0.75 regular)*R por direccion.
  useEffect(() => {
    const d = calcEspectroDiseno(disenoEspectro);
    if (!d.valido) return;
    const r4 = v => Math.round(v * 1e4) / 1e4;
    const sfY = d.Ry ? r4(d.Rx / d.Ry) : 1;
    setEspectroParams(prev => ({ ...prev, z: d.Z, u: d.U, s: d.S, tp: d.TP, tl: d.TL, r: r4(d.Rx), sfX: 1, sfY }));
    const irr = d.Iax < 1 || d.Iay < 1 || d.Ipx < 1 || d.Ipy < 1;
    const fac = irr ? 0.85 : 0.75;
    setComboParams(prev => ({ ...prev, factorDerivaX: r4(fac * d.Rx), factorDerivaY: r4(fac * d.Ry) }));
  }, [disenoEspectro]);
  // Vista previa: fuente de la grilla (formulario uniforme o el de ordenadas)
  // y resumen del modelo REAL leido de ETABS para contrastar.
  const [fuenteGrilla, setFuenteGrilla] = useState(() => {
    try { return localStorage.getItem('etabs_fuente_grilla') || 'uniforme'; } catch { return 'uniforme'; }
  });
  const [vistaModelInfo, setVistaModelInfo] = useState('');
  // Resumen estructurado del modelo real (para la grilla 3D/planta/elevacion).
  const [vistaResumen, setVistaResumen] = useState(null);
  const [vistaLosa, setVistaLosa] = useState('losa1d');
  // Navegacion estilo ETABS en Vista previa: nivel de planta y eje de elevacion.
  const [nivelVista, setNivelVista] = useState(1);   // indice en nivelesPreview
  const [ejeVista, setEjeVista] = useState('A');     // 'A','B'.. (eje en Y) o '1','2'.. (eje en X)
  // MODELADOR (mini-CAD): herramienta activa, punto pendiente, hover, seccion
  // por tipo y elementos dibujados (persistidos en localStorage).
  const [modTool, setModTool] = useState('sel');     // sel|columna|viga|losa|muro|borrar
  const [modPend, setModPend] = useState(null);      // primer punto {ix,iy} de viga/muro
  const [modHover, setModHover] = useState(null);    // {ix,iy} o {ci,cj} para el snap
  const [modSec, setModSec] = useState({ columna: '', viga: '', losa: '', muro: '' });
  const [dibujoElementos, setDibujoElementos] = useState(() => {
    try {
      const arr = JSON.parse(localStorage.getItem('etabs_dibujo') || '[]');
      // Migra losas rectangulares viejas (x0,x1,y0,y1) a poligonales (pts).
      return arr.map(el => (el.tipo === 'losa' && !el.pts) ? { ...el, pts: [{ x: el.x0, y: el.y0 }, { x: el.x1, y: el.y0 }, { x: el.x1, y: el.y1 }, { x: el.x0, y: el.y1 }] } : el);
    } catch { return []; }
  });
  const [modLosaPts, setModLosaPts] = useState(null);   // poligono de losa en curso
  const lienzoRef = useRef(null);
  const [modOffsetDist, setModOffsetDist] = useState(0.5);  // distancia offset (m)
  const [modGrab, setModGrab] = useState(null);   // stretch: {id, cual:'p'|'1'|'2'}
  const [modPoly, setModPoly] = useState(null);   // polilinea: ultimo punto {x,y}
  const [modMax, setModMax] = useState(false);    // planta a pantalla completa
  const [modCmd, setModCmd] = useState('');       // barra de comandos tipo AutoCAD
  const [modMove, setModMove] = useState(null);   // mover/copiar: {id, bx, by} base
  const [snapOn, setSnapOn] = useState(true);     // OSNAP maestro on/off
  const [snapModes, setSnapModes] = useState({ grid: true, fin: true, med: true });
  const [modSel, setModSel] = useState(null);     // id del elemento seleccionado
  const [storyMode, setStoryMode] = useState('one'); // one | similar | all (pisos al dibujar)
  const [simStories, setSimStories] = useState(() => new Set()); // niveles "similares"
  const [orthoOn, setOrthoOn] = useState(false);  // modo ORTO (horiz/vert)
  const [rotAng, setRotAng] = useState(90);       // angulo para Rotar (grados)
  const [arrayP, setArrayP] = useState({ nx: 3, ny: 1, dx: 5, dy: 4 }); // matriz
  const [moveP, setMoveP] = useState({ dx: 0.5, dy: 0 }); // mover/copiar por distancia
  // Geometria REAL leida de ETABS (frames/areas + grilla + pisos) para el Modelador.
  // Persistida en localStorage: la grilla y el snapshot sobreviven al recargar.
  const [modeloGeo, setModeloGeo] = useState(() => {
    try { const s = localStorage.getItem('etabs_modelo_geo'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [modGeoLoading, setModGeoLoading] = useState(false);
  const cmdRef = useRef(null);                            // input de la barra de comandos
  useEffect(() => {
    try { localStorage.setItem('etabs_dibujo', JSON.stringify(dibujoElementos)); } catch { /* sin storage */ }
  }, [dibujoElementos]);
  // Persistir la geometria leida (grilla + pisos + snapshot) y la fuente de grilla,
  // para que el Modelador conserve la grilla real al recargar la pagina (v3.21.10).
  useEffect(() => {
    try {
      if (modeloGeo) localStorage.setItem('etabs_modelo_geo', JSON.stringify(modeloGeo));
      else localStorage.removeItem('etabs_modelo_geo');
    } catch { /* sin storage */ }
  }, [modeloGeo]);
  useEffect(() => {
    try { localStorage.setItem('etabs_fuente_grilla', fuenteGrilla); } catch { /* sin storage */ }
  }, [fuenteGrilla]);
  // Historial UNDO / REDO del dibujo (Ctrl+Z deshacer · Ctrl+Y / Ctrl+Shift+Z rehacer).
  const histRef = useRef({ pasado: [], futuro: [] });
  const prevDibujoRef = useRef(dibujoElementos);
  const aplicandoRef = useRef(false);
  useEffect(() => {
    if (aplicandoRef.current) { aplicandoRef.current = false; prevDibujoRef.current = dibujoElementos; return; }
    if (prevDibujoRef.current === dibujoElementos) return;
    histRef.current.pasado.push(prevDibujoRef.current);
    if (histRef.current.pasado.length > 120) histRef.current.pasado.shift();
    histRef.current.futuro = [];
    prevDibujoRef.current = dibujoElementos;
  }, [dibujoElementos]);
  const deshacerDibujo = useCallback(() => {
    const h = histRef.current; if (!h.pasado.length) return;
    h.futuro.push(prevDibujoRef.current); aplicandoRef.current = true; setDibujoElementos(h.pasado.pop());
  }, []);
  const rehacerDibujo = useCallback(() => {
    const h = histRef.current; if (!h.futuro.length) return;
    h.pasado.push(prevDibujoRef.current); aplicandoRef.current = true; setDibujoElementos(h.futuro.pop());
  }, []);
  useEffect(() => {
    if (mainTab !== 'modelador') return undefined;
    const enInput = () => { const a = document.activeElement; return a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
    const onKey = e => {
      if (e.key === 'Escape') { setModPend(null); setModPoly(null); setModGrab(null); setModMove(null); setModLosaPts(null); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) rehacerDibujo(); else deshacerDibujo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); rehacerDibujo(); return; }
      if ((e.key === 'Delete' || e.key === 'Supr') && !enInput() && modSel != null) { setDibujoElementos(prev => prev.filter(x => x.id !== modSel)); setModSel(null); return; }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1 && /[a-zA-Z0-9,.\-]/.test(e.key) && !enInput()) {
        e.preventDefault(); setModCmd(c => c + e.key.toUpperCase()); if (cmdRef.current) cmdRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mainTab, modSel, deshacerDibujo, rehacerDibujo]);
  // Analisis y resultados (v3.0): el analisis es un paso del flujo (script);
  // los resultados se leen del servidor (GET /etabs/resultados).
  const [analizarParams, setAnalizarParams] = useState({ rutaGuardado: '' });
  const [examinandoRuta, setExaminandoRuta] = useState(false);  // dialogo "Guardar como" abierto
  const [resParams, setResParams] = useState({ derivas: 'DERVX,DERVY', limite: 0.007, cortantes: 'CM,CV,CSX,CSY', modal: 'Modal', desplaz: 'CSX,CSY' });
  const [resData, setResData] = useState(null);
  const [resError, setResError] = useState('');
  const [resLoading, setResLoading] = useState(false);
  // Verificacion cruzada con OpenSees (v3.23.0): modelo elastico equivalente
  // (porticos en toda la grilla) corrido en el venv 3.12 para contrastar T,
  // masa, cortante y derivas contra ETABS. Parametros representativos editables.
  const [osParams, setOsParams] = useState({ nmodes: 12 });
  const [osData, setOsData] = useState(null);
  const [osError, setOsError] = useState('');
  const [osLoading, setOsLoading] = useState(false);
  // Datos del modelo REAL extraidos de ETABS (conteos, secciones, losas, masas) para
  // compararlos con OpenSees (v3.26.0).
  const [etabsModelo, setEtabsModelo] = useState(null);
  const [etabsModeloLoading, setEtabsModeloLoading] = useState(false);
  const [etabsModeloError, setEtabsModeloError] = useState('');
  // Memoria de calculo de materiales (LaTeX + render KaTeX en la app).
  const [memoriaParams, setMemoriaParams] = useState({ norma: 'E060', fc: 280, fy: 4200, gammaC: 2400, gammaS: 7850, es: 2000000, poisson: 0.20, encabezadoIzq: 'INGENIERIA FACIL', encabezadoDer: 'www.ingenieriafacil.com' });
  // Parametros de la memoria de LONGITUD DE DESARROLLO A TRACCION (E.060/ACI).
  const [desarrolloParams, setDesarrolloParams] = useState({ fc: 280, fy: 4200, barra: '1"', lambda: 1, psiT: 1.3, psiE: 1, psiG: 1, psiS: 1, r: 4, estribo: '3/8"', s: 10, n: 3 });
  // Parametros de la memoria de DISEÑO DE FLEXION DE VIGAS (ACI 318-19 / E.060).
  const [flexionParams, setFlexionParams] = useState({ hv: 25, b: 10, r: 4, phi: 0.9, fc: 280, fy: 4200, es: 2000000, Mu: 4723.25, barra: '1"' });
  // Parametros de la memoria de DISTRIBUCION DE REFUERZO POR FLEXION (ACI 18.4.2.2 / E.060 21.4.4.2).
  const [distribParams, setDistribParams] = useState({ b: 40, d: 64, fc: 280, fy: 4200, phi: 0.9, M1: 5145245.46, M2: 4716298.17, M3: 2517230.11 });
  // Documento activo en la pestana Memoria: 'materiales' | 'espectro' | 'desarrollo' | 'flexion' | 'distrib'.
  const [memoriaTipo, setMemoriaTipo] = useState('materiales');
  const [savedFlows, setSavedFlows] = useState([]);
  const [lastRunOk, setLastRunOk] = useState(false);
  const [lastCodeFromAi, setLastCodeFromAi] = useState(false);
  const [autoRepair, setAutoRepair] = useState(true);
  const autoRepairUsedRef = useRef(false);
  const [savedLessons, setSavedLessons] = useState([]);
  const [serverOutdated, setServerOutdated] = useState(false);
  // Par pendiente error->solucion: se llena al reparar, se confirma al ejecutar con exito.
  const pendingLessonRef = useRef(null);
  const [nuGridParams, setNuGridParams] = useState({
    numeroPisos: 1,
    alturaPiso: 3.0,
    ordenadasX: '0, 2, 5',
    ordenadasY: '0, 5, 9'
  });
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [docSearchItems, setDocSearchItems] = useState([]);
  const [docSearchMsg, setDocSearchMsg] = useState('');
  const [gridParams, setGridParams] = useState({
    // Altura de CADA piso (abajo->arriba), estilo Tekla. "4 5 5" o "4 2*5" = [4,5,5].
    alturasPisos: '3.5, 3, 3, 3',
    // Luces (separaciones) entre ejes consecutivos: NO uniforme. Lista por vano.
    espaciamientosX: '5, 4, 6, 5',
    espaciamientosY: '5, 4, 5',
    // Ejes INCLINADOS (opcional): linea "General (Cartesian)" por 2 puntos (regla 32).
    // Cada uno: { id, x1, y1, x2, y2, bubble:'Start'|'End' } en metros.
    ejesInclinados: []
  });

  const chatEndRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('etabs_ai_config_final', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('etabs_steps_done__' + proyecto, JSON.stringify(stepsDone));
    localStorage.setItem('etabs_proyecto', proyecto);
  }, [stepsDone, proyecto]);

  // Cambiar de proyecto: guarda el actual y carga el progreso del nuevo.
  const cambiarProyecto = useCallback((nuevo) => {
    const limpio = (nuevo || '').trim() || 'Proyecto 1';
    let s = {};
    try { s = JSON.parse(localStorage.getItem('etabs_steps_done__' + limpio) || '{}'); } catch { s = {}; }
    setProyecto(limpio);
    setStepsDone(s);
  }, []);

  // Lista las instancias de ETABS abiertas (para el selector). PID + modelo.
  const cargarInstancias = useCallback(async () => {
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/processes`);
      const data = await r.json();
      const procs = (data.procesos || []).filter(p => !p.zombie);
      setInstancias(procs);
      // Si la seleccion ya no existe, volver a "la registrada".
      if (instanciaPid && !procs.some(p => p.pid === instanciaPid)) setInstanciaPid(0);
      return procs;
    } catch {
      setInstancias([]);
      return [];
    }
  }, [config.pythonUrl, instanciaPid]);

  const marcarPaso = useCallback((stepId) => {
    setStepsDone(prev => ({ ...prev, [stepId]: true }));
    // El caso Modal y los de sismo CSX/CSY se crean en "Espectro de diseno", por eso
    // "Definir casos de carga" (automatico) se da por hecho al completar el espectro.
    if (stepId === 'espectro') setStepsDone(prev => ({ ...prev, espectro: true, casos: true }));
  }, []);

  // Disponibilidad de un paso: todas sus dependencias deben estar cumplidas. Una dep que
  // TODAVIA no esta implementada (placeholder del esquema) NO bloquea por si misma, pero
  // SI exige sus propios prerequisitos reales (se atraviesa de forma transitiva). Asi la
  // cadena Patrones→MassSource(placeholder)→Espectro mantiene a Espectro tras Patrones.
  const reqCumplido = useCallback((id, seen = new Set()) => {
    if (seen.has(id)) return true;
    seen.add(id);
    const dep = WORKFLOW_STEPS.find(s => s.id === id);
    if (!dep) return true;
    if (!dep.implementado) return (dep.deps || []).every(d => reqCumplido(d, seen));
    return !!stepsDone[id];
  }, [stepsDone]);

  const stepDisponible = useCallback((step) => {
    if (!step.implementado) return false;
    return (step.deps || []).every(d => reqCumplido(d));
  }, [reqCumplido]);

  const stepEstado = useCallback((step) => {
    if (stepsDone[step.id]) return 'done';
    if (!step.implementado) return 'proximamente';
    return stepDisponible(step) ? 'disponible' : 'bloqueado';
  }, [stepsDone, stepDisponible]);

  // Carga flujos validados y lecciones aprendidas desde el servidor al iniciar.
  useEffect(() => {
    fetch(`${config.pythonUrl}/flujos`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.flujos)) setSavedFlows(data.flujos); })
      .catch(() => { /* servidor no disponible aun; se reintenta al guardar */ });
    fetch(`${config.pythonUrl}/lecciones`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.lecciones)) setSavedLessons(data.lecciones); })
      .catch(() => { /* sin lecciones por ahora */ });
    // Detectar servidor desactualizado (frontend nuevo + proceso viejo).
    fetch(`${config.pythonUrl}/status`)
      .then(r => r.json())
      .then(data => setServerOutdated(data.server_version !== EXPECTED_SERVER_VERSION))
      .catch(() => { /* sin servidor; los botones ya avisan */ });
    // Catalogo de herramientas para el modo agente (tool-calling multi-proveedor).
    fetch(`${config.pythonUrl}/ai/tools`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.tools)) setAiTools(data.tools); })
      .catch(() => { /* sin servidor; el modo agente avisara */ });
    // Instancias de ETABS abiertas (para el selector de instancia).
    fetch(`${config.pythonUrl}/etabs/processes`)
      .then(r => r.json())
      .then(data => setInstancias((data.procesos || []).filter(p => !p.zombie)))
      .catch(() => { /* sin servidor */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const geminiKeys = useMemo(() => splitKeys(config.geminiApiKeys), [config.geminiApiKeys]);
  const openaiKeys = useMemo(() => splitKeys(config.openaiApiKeys), [config.openaiApiKeys]);
  const anthropicKeys = useMemo(() => splitKeys(config.anthropicApiKeys), [config.anthropicApiKeys]);

  const activeProvider = config.aiProvider || 'gemini';
  const activeLabel = activeProvider === 'openai' ? 'OpenAI' : activeProvider === 'anthropic' ? 'Claude' : 'Gemini';
  const activeModel = normalizeModelId(
    activeProvider === 'openai'
      ? config.openaiModel === 'custom' ? config.customOpenaiModel : config.openaiModel
      : activeProvider === 'anthropic'
        ? config.anthropicModel === 'custom' ? config.customAnthropicModel : config.anthropicModel
        : config.geminiModel === 'custom' ? config.customGeminiModel : config.geminiModel
  );
  const activeKeys = activeProvider === 'openai' ? openaiKeys : activeProvider === 'anthropic' ? anthropicKeys : geminiKeys;
  const activeMode = getMode(sessionMode);

  const showStatus = useCallback((type, message) => {
    setStatus({ type, message });
    setTimeout(() => setStatus({ type: '', message: '' }), 4200);
  }, []);

  // HTML resaltado del editor (overlay). El '\n' final asegura que la ultima linea
  // del <pre> exista para que su alto coincida con el del <textarea> transparente.
  const highlightedCode = useMemo(() => highlightPython(pythonCode) + '\n', [pythonCode]);

  const getSystemInstruction = useCallback(() => `
Eres un ingeniero estructural experto en automatizacion de ETABS mediante CSi API en Python.

SALIDA OBLIGATORIA:
Devuelve SIEMPRE un unico objeto JSON valido, sin markdown:
{
  "explanation": "explicacion breve",
  "execution_plan": ["paso 1", "paso 2"],
  "assumptions": ["supuesto usado"],
  "warnings": ["riesgo o advertencia"],
  "needs_user_confirmation": false,
  "code": "def construir_modelo(sap_model): ... (solo esta funcion y auxiliares)"
}

ARQUITECTURA: la app ensambla el script final. Tu NO escribes la conexion: la
app antepone un BLOQUE BASE validado (imports, conexion segun el modo, main())
y tu codigo se inserta como la funcion construir_modelo(sap_model).

REGLAS ESTRICTAS:
1. En "code" devuelve UNICAMENTE: def construir_modelo(sap_model): ... y, si
   hacen falta, funciones auxiliares que construir_modelo llame. NADA MAS.
2. PROHIBIDO en "code" (el bloque base YA lo tiene; duplicarlo ROMPE el script):
   import, comtypes, helper, GetObject, CreateObject, CreateObjectProgID,
   ApplicationStart, ApplicationExit, InitializeNewModel, def main(),
   if __name__, redefinir verificar_retorno o reintentar.
3. DENTRO de construir_modelo SI puedes usar (ya existen): sap_model,
   verificar_retorno(ret, accion), reintentar(funcion, accion), time, print.
4. PRIMER PASO en modos de modelo nuevo: crear el modelo con UNO SOLO de:
   ret = reintentar(lambda: sap_model.File.NewGridOnly(...), "Crear grilla")
   ret = reintentar(lambda: sap_model.File.NewBlank(), "Modelo en blanco")
   NUNCA ambos (NewGridOnly con modelo ya creado CRASHEA ETABS).
   En modo "modelo actual" NO crees modelo nuevo.
5. Verifica TODA llamada API con verificar_retorno(ret, "accion").
6. Si el usuario pide kN, m, C usa 6. Nunca 12 para kN, m, C.
7. No ejecutes RunAnalysis salvo pedido explicito.
8. PRIORIDAD MAXIMA: si el mensaje incluye "DOCUMENTACION OFICIAL ETABS 22",
   esas firmas son la verdad absoluta. NO inventes metodos ni parametros
   (SetGridLine NO existe; SetTableForEditingArray NO tiene GroupName).
9. ByRef en Python comtypes (verificado en esta maquina): los parametros ByRef
   SI SE PASAN en la llamada, como relleno del tipo correcto (string -> "",
   double -> 0.0, int -> 0, array -> [], bool -> False), en su posicion
   original. Omitirlos da "required argument 'X' missing". Las salidas reales
   vuelven en el retorno y comtypes las ENVUELVE en UNA LISTA ANIDADA.
   SIEMPRE desanida antes de parsear con este patron:
   partes = list(resultado) if isinstance(resultado, (list, tuple)) else [resultado]
   while len(partes) == 1 and isinstance(partes[0], (list, tuple)): partes = list(partes[0])
   Sin desanidar, los resultados parecen "ret=-1" aunque la llamada funciono.
10. DatabaseTables SIEMPRE en orden Get -> modificar -> Set -> Apply, leyendo
    primero los campos reales. TableData es lista PLANA de strings.
    GetTableForEditingArray desanidado devuelve: [version, campos, num_filas, datos, ret].
    En ETABS 22 la tabla "Grid Definitions - Grid Lines" tiene campos:
    Name, LineType ('X (Cartesian)'/'Y (Cartesian)'), ID, Ordinate, Angle, X1, Y1, X2, Y2, BubbleLoc, Visible.
11. Si hay un FLUJO VALIDADO para la tarea, copia su logica exactamente.
12. PROHIBIDO RENDIRSE: nunca devuelvas un construir_modelo que solo imprime
    advertencias o dice "hazlo manualmente". Implementa la tarea completa con
    las recetas de la documentacion. Si falta informacion critica, pon
    needs_user_confirmation=true y explica en warnings, pero el codigo debe
    hacer todo lo que SI se puede hacer.
13. PROHIBIDO el try/except global que trague errores: las excepciones deben
    propagarse para que el servidor reporte el fallo real.
14. Si hay incertidumbre tecnica, declarala en warnings.

MODO ETABS ACTUAL (la app YA genera esta conexion en el bloque base; es solo contexto para que sepas que hara main() antes de llamar a construir_modelo):
Modo: ${activeMode.label}
connection_mode sugerido: ${activeMode.connection_mode}
model_mode sugerido: ${activeMode.model_mode}
Instruccion: ${activeMode.instruction}
Archivo .EDB: ${modelFilePath || 'No indicado'}
Unidades sugeridas: ${selectedUnits}

DOCUMENTACION API:
${config.documentationContext || DEFAULT_API_CONTEXT}

${savedFlows.length ? `FLUJOS VALIDADOS POR EL USUARIO (codigo probado, usalo como referencia exacta):
${savedFlows.map(f => `--- ${f.nombre} ---\n${f.codigo}`).join('\n\n')}` : ''}

${savedLessons.length ? `LECCIONES APRENDIDAS (errores REALES ya resueltos en esta maquina - NO los repitas):
${savedLessons.slice(-6).map(l => `--- ${l.titulo} ---\nERROR QUE OCURRIO:\n${String(l.error).slice(0, 400)}\nCODIGO QUE LO RESOLVIO:\n${String(l.solucion).slice(0, 1200)}`).join('\n\n')}` : ''}
`, [activeMode, modelFilePath, selectedUnits, config.documentationContext, savedFlows, savedLessons]);

  // Inspirado en los getters de FEA-MCP: lee el modelo abierto para que la IA
  // conozca los nombres REALES (secciones, materiales, pisos) en vez de adivinar.
  const fetchModelSummary = useCallback(async () => {
    try {
      const response = await fetch(`${config.pythonUrl}/etabs/model-summary?pid=${instanciaPid || 0}`);
      const data = await response.json();
      if (!data.success || !data.resumen) return null;
      return data.resumen;
    } catch {
      return null;
    }
  }, [config.pythonUrl, instanciaPid]);

  const formatModelSummary = (r) => {
    if (!r) return '';
    const def = x => x.default ? ' [def ETABS]' : '';   // marcar los de ETABS
    const conc = (r.concretos || []).map(c => `${c.nombre} (f'c=${c.fc ?? '?'} kg/cm², E=${c.modulo ?? '?'})${def(c)}`).join(', ') || '(ninguno)';
    const acer = (r.aceros || []).map(a => `${a.nombre} (Fy=${a.fy ?? '?'}, Fu=${a.fu ?? '?'} kg/cm²)${def(a)}`).join(', ') || '(ninguno)';
    const otros = (r.otros_materiales || []).map(o => `${o.nombre} (${o.tipo})${def(o)}`).join(', ');
    const sec = (arr) => (arr || []).map(s => `${s.nombre} ${s.base ?? '?'}×${s.peralte ?? '?'} cm [${s.material}]${def(s)}`).join(', ') || '(ninguna)';
    const losas = [...(r.losas_maciza || []), ...(r.losas_1d || []), ...(r.losas_2d || [])];
    const fLosas = losas.map(l => `${l.nombre} (${l.tipo || 'losa'}, e=${l.espesor ?? '?'} cm)${def(l)}`).join(', ') || '(ninguna)';
    const fMuros = (r.muros || []).map(m => `${m.nombre} (e=${m.espesor ?? '?'} cm [${m.material}])${def(m)}`).join(', ') || '(ninguno)';
    return [
      `Modelo: ${r.modelo} | Unidades: ${r.unidades} (8 = kgf, m, C)`,
      `Pisos: ${(r.pisos || []).join(', ')} | Elevaciones: ${(r.elevaciones || []).join(', ')} | Base z=${r.base_z}`,
      `Grilla X: ${(r.grilla_x || []).join(', ')}`,
      `Grilla Y: ${(r.grilla_y || []).join(', ')}`,
      `Materiales concreto: ${conc}`,
      `Materiales acero: ${acer}`,
      ...(otros ? [`Otros materiales: ${otros}`] : []),
      `Secciones de viga: ${sec(r.secciones_viga)}`,
      `Secciones de columna: ${sec(r.secciones_columna)}`,
      `Losas: ${fLosas}`,
      `Muros: ${fMuros}`,
      `Elementos frame dibujados: ${r.num_frames} | Áreas: ${r.num_areas} | Puntos: ${r.num_puntos}`,
      `Patrones de carga: ${(r.patrones || []).map(p => `${p.nombre} (${p.tipo})${def(p)}`).join(', ') || '(ninguno)'}`,
      `Casos de carga: ${(r.casos || []).map(c => `${c.nombre} (${c.tipo})`).join(', ') || '(ninguno)'}`,
      `Combinaciones: ${(r.combinaciones || []).map(c => `${c.nombre} = ${c.formula}`).join(' | ') || '(ninguna)'}`,
      `(Nota: [def ETABS] = material/seccion que ETABS trae por defecto, no creado por el usuario)`
    ].join('\n');
  };

  const fetchApiDocs = useCallback(async (queryText) => {
    try {
      const response = await fetch(`${config.pythonUrl}/api-docs/search?q=${encodeURIComponent(queryText)}&limit=8`);
      const data = await response.json();
      if (!data.success || !Array.isArray(data.results) || !data.results.length) return '';

      const bloques = data.results.map(d => {
        let bloque = `### ${d.title} [${d.kind}]`;
        if (d.signature) bloque += `\n${d.signature}`;
        if (d.enum_members) bloque += `\nValores: ${d.enum_members}`;
        if (d.remarks) bloque += `\nNotas oficiales: ${d.remarks}`;
        if (d.example) bloque += `\nEjemplo oficial (C#/VB, traducir a Python):\n${d.example}`;
        return bloque;
      });

      return `
DOCUMENTACION OFICIAL ETABS 22 (firmas exactas extraidas del CHM de la instalacion del usuario).
REGLAS DE USO:
- USA SOLO metodos que aparezcan aqui o en los FLUJOS VALIDADOS. Si necesitas un metodo que no esta, declaralo en warnings y NO lo inventes.
- En Python con comtypes, los parametros 'ref'/ByRef SI SE PASAN como relleno del tipo correcto ("" para string, 0.0 para double, 0 para int, [] para arrays) en su posicion original; omitirlos da "required argument missing". Las salidas reales vuelven en el retorno, ENVUELTAS en una lista anidada (desanidar antes de parsear); el codigo ret es el ULTIMO entero.
- Los ejemplos oficiales estan en C#/VB: traducelos al patron Python comtypes.

${bloques.join('\n\n')}
`;
    } catch {
      return '';
    }
  }, [config.pythonUrl]);

  const buildPrompt = useCallback(({ instruction, isRepair = false, errorText = '', apiDocs = '', modelInfo = '' }) => {
    const history = messages.slice(-8).map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`).join('\n');
    return `
HISTORIAL RECIENTE:
${history}

CODIGO ACTUAL:
${pythonCode}
${modelInfo ? `\nESTADO ACTUAL DEL MODELO EN ETABS (leido en vivo - usa estos nombres EXACTOS, no inventes otros):\n${modelInfo}\n` : ''}${apiDocs}
${isRepair ? `ERROR OBTENIDO:\n${errorText}\n\nTAREA: Corrige el codigo actual.` : `INSTRUCCION DEL USUARIO:\n${instruction}`}
`;
  }, [messages, pythonCode]);

  const runLocalPreflight = useCallback((code) => {
    const errors = [];
    const warnings = [];
    const text = String(code || '');

    // El codigo es un script completo que se ejecuta tal cual (como en cmd).
    // No bloqueamos imports ni COM; solo validaciones utiles y advertencias.
    if (!text.trim()) errors.push('El editor esta vacio.');

    // Errores que romperian la ejecucion en cualquier caso:
    if (text.includes('"VALOR"')) {
      errors.push('Hay valores de plantilla SIN RELLENAR: busca "VALOR" y los comentarios "<- RELLENA" en el editor, y coloca datos reales antes de ejecutar.');
    }
    if (/SetPresentUnits\s*\(\s*12\s*\)/i.test(text) && /kN|kn/i.test(text)) {
      errors.push('SetPresentUnits(12) no es kN, m, C. Usa 6.');
    }
    if (sessionMode === 'open_file_then_modify' && !modelFilePath.trim()) {
      errors.push('Modo abrir .EDB: falta la ruta del archivo .EDB.');
    }

    // Advertencias (no bloquean):
    if (text.trim()) {
      if (!/comtypes/i.test(text) && !/CreateObject|GetObject/i.test(text)) {
        warnings.push('El script no parece conectarse a ETABS (sin comtypes/CreateObject). Quiza no haga nada.');
      }
      if (!/SapModel/i.test(text)) {
        warnings.push('El codigo no usa SapModel. Puede que no modele nada en ETABS.');
      }
      if (!/verificar_retorno\s*\(|check_ret\s*\(/.test(text)) {
        warnings.push('No se verifica el retorno de la API (verificar_retorno/check_ret).');
      }
      if (/SetGridSys\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,/is.test(text)) {
        warnings.push('SetGridSys parece tener demasiados argumentos. Para grilla regular usa NewGridOnly.');
      }
      if (sessionMode === 'code_only') {
        warnings.push('Modo solo codigo. No se ejecutara desde la app; guardalo y corrolo en cmd.');
      }
    }

    return { ok: errors.length === 0, errors, warnings };
  }, [sessionMode, modelFilePath]);

  const renderPreflight = (preflight) => {
    const lines = [];
    if (preflight.errors.length) {
      lines.push('ERRORES BLOQUEANTES:');
      preflight.errors.forEach((err, index) => lines.push(`${index + 1}. ${err}`));
    }
    if (preflight.warnings.length) {
      lines.push('\nADVERTENCIAS:');
      preflight.warnings.forEach((warn, index) => lines.push(`${index + 1}. ${warn}`));
    }
    return lines.join('\n').trim();
  };

  const callGemini = useCallback(async ({ key, promptText }) => {
    const model = normalizeModelId(activeModel);
    const body = (withSchema) => ({
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: getSystemInstruction() }] },
      generationConfig: {
        responseMimeType: 'application/json',
        ...(withSchema ? { responseSchema: RESPONSE_SCHEMA } : {}),
        maxOutputTokens: 12000,
        temperature: 0.15
      }
    });

    let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body(true))
    });

    if (!response.ok) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(false))
      });
    }

    if (!response.ok) throw new Error((await response.text()).slice(0, 800));
    const result = await response.json();
    return result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }, [activeModel, getSystemInstruction]);

  const callOpenAI = useCallback(async ({ key, promptText }) => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: normalizeModelId(activeModel),
        messages: [
          { role: 'system', content: getSystemInstruction() },
          { role: 'user', content: promptText }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'etabs_script_response', strict: true, schema: RESPONSE_SCHEMA } },
        temperature: 0.15
      })
    });

    if (!response.ok) throw new Error((await response.text()).slice(0, 800));
    const result = await response.json();
    return result?.choices?.[0]?.message?.content || '';
  }, [activeModel, getSystemInstruction]);

  // ============================================================
  // MODO AGENTE (v3.1.0): tool-calling multi-proveedor
  // Catalogo unico (servidor) adaptado al formato de cada proveedor. Historia
  // NORMALIZADA en memoria; cada turno se serializa al proveedor activo.
  // ============================================================
  const getAgentSystemInstruction = useCallback(() => `
Eres un asistente de ingenieria estructural que CONTROLA ETABS 22 mediante herramientas (tool-calling).
Trabajas para un ingeniero civil peruano (flujo E.030/E.060). Responde SIEMPRE en espanol, claro y conciso.

FILOSOFIA (obligatoria): lo determinista primero, tu haces lo MINIMO necesario.
- ANTES de escribir codigo nuevo: usa obtener_guia_scripts y obtener_flujo/listar_flujos_validados
  para copiar la logica de un flujo YA validado. Usa buscar_api_etabs para firmas exactas.
- Para conocer el estado real usa leer_modelo_abierto (nombres reales) y leer_resultados (tras analizar).
- Si el usuario pide construir/modificar el modelo, escribe un script Python COMPLETO Y AUTONOMO
  (import comtypes, conexion como en los flujos, def main()) y ejecutalo con ejecutar_script_etabs.
  Preferir ejecutar_flujo cuando exista un flujo validado que ya haga lo pedido.
- Las herramientas de ACCION (ejecutar_script_etabs, ejecutar_flujo, cerrar_procesos_etabs)
  REQUIEREN que el usuario confirme; si cancela, no insistas: propon alternativas.
- No ejecutes analisis (RunAnalysis) salvo que el usuario lo pida explicitamente.
- Cuando termines, explica en lenguaje natural QUE hiciste y QUE resulto (no vuelques JSON crudo).
`, []);

  // Serializa la historia normalizada al formato de cada proveedor.
  const toolsParaProveedor = useCallback((proveedor) => {
    if (!aiTools.length) return null;
    if (proveedor === 'openai') {
      return aiTools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    if (proveedor === 'anthropic') {
      return aiTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    // gemini
    return [{ functionDeclarations: aiTools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  }, [aiTools]);

  // Llama al proveedor activo con la historia + tools y normaliza la respuesta
  // a { text, toolCalls: [{id, name, args}] }.
  const llamarProveedorConTools = useCallback(async ({ proveedor, key, model, system, historia }) => {
    if (proveedor === 'gemini') {
      const contents = historia.map(h => {
        if (h.role === 'user') return { role: 'user', parts: [{ text: h.text }] };
        if (h.role === 'assistant') {
          const parts = [];
          if (h.text) parts.push({ text: h.text });
          (h.toolCalls || []).forEach(tc => parts.push({ functionCall: { name: tc.name, args: tc.args || {} } }));
          return { role: 'model', parts: parts.length ? parts : [{ text: '' }] };
        }
        return { role: 'user', parts: [{ functionResponse: { name: h.name, response: { result: h.content } } }] };
      });
      const body = { contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: { temperature: 0.15, maxOutputTokens: 8000 } };
      const tools = toolsParaProveedor('gemini');
      if (tools) body.tools = tools;
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error((await resp.text()).slice(0, 800));
      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter(p => p.text).map(p => p.text).join('').trim();
      const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: `g_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
      return { text, toolCalls };
    }
    if (proveedor === 'openai') {
      const messages = [{ role: 'system', content: system }];
      historia.forEach(h => {
        if (h.role === 'user') messages.push({ role: 'user', content: h.text });
        else if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.text || null, ...(h.toolCalls?.length ? { tool_calls: h.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) } : {}) });
        else messages.push({ role: 'tool', tool_call_id: h.id, content: h.content });
      });
      const body = { model, messages, temperature: 0.15 };
      const tools = toolsParaProveedor('openai');
      if (tools) body.tools = tools;
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error((await resp.text()).slice(0, 800));
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message || {};
      const toolCalls = (msg.tool_calls || []).map(tc => { let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch { a = {}; } return { id: tc.id, name: tc.function.name, args: a }; });
      return { text: (msg.content || '').trim(), toolCalls };
    }
    // anthropic (via proxy local del servidor)
    const messages = [];
    historia.forEach(h => {
      if (h.role === 'user') messages.push({ role: 'user', content: h.text });
      else if (h.role === 'assistant') {
        const content = [];
        if (h.text) content.push({ type: 'text', text: h.text });
        (h.toolCalls || []).forEach(tc => content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} }));
        messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '...' }] });
      } else {
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: h.id, content: h.content }] });
      }
    });
    const body = { api_key: key, model, system, messages, max_tokens: 4096, temperature: 0.15 };
    const tools = toolsParaProveedor('anthropic');
    if (tools) body.tools = tools;
    const resp = await fetch(`${config.pythonUrl}/ai/anthropic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Error del proxy de Claude.');
    const bloques = data.response?.content || [];
    const text = bloques.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const toolCalls = bloques.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} }));
    return { text, toolCalls };
  }, [toolsParaProveedor, config.pythonUrl]);

  // Pide confirmacion al usuario para una herramienta de accion (devuelve bool).
  const pedirConfirmacion = useCallback((name, args) => new Promise(resolve => {
    pendingToolRef.current = resolve;
    setPendingTool({ name, arguments: args });
  }), []);

  const resolverConfirmacion = useCallback((aceptar) => {
    setPendingTool(null);
    const resolver = pendingToolRef.current;
    pendingToolRef.current = null;
    if (resolver) resolver(aceptar);
  }, []);

  const ejecutarTool = useCallback(async (name, args) => {
    const resp = await fetch(`${config.pythonUrl}/ai/tools/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args })
    });
    const data = await resp.json();
    if (!data.success) return { error: data.error || 'Error ejecutando la herramienta.' };
    return data.result;
  }, [config.pythonUrl]);

  const requiereConfirmacion = useCallback((name) => aiTools.find(t => t.name === name)?.requires_confirmation, [aiTools]);

  const runAgentChat = useCallback(async (instruction) => {
    if (!aiTools.length) { showStatus('error', 'No hay catalogo de herramientas (revisa el servidor: banner rojo).'); return; }
    if (activeKeys.length === 0) { showStatus('error', `Ingresa al menos una API Key de ${activeLabel}.`); return; }
    const model = normalizeModelId(activeModel);
    const key = activeKeys[currentKeyIndex[activeProvider] || 0];
    const system = getAgentSystemInstruction();

    setMessages(prev => [...prev, { role: 'user', content: instruction }]);
    setIsLoading(true);
    const historia = [{ role: 'user', text: instruction }];

    try {
      for (let paso = 0; paso < 10; paso++) {
        const { text, toolCalls } = await llamarProveedorConTools({ proveedor: activeProvider, key, model, system, historia });
        if (text) setMessages(prev => [...prev, { role: 'assistant', content: text }]);
        historia.push({ role: 'assistant', text, toolCalls });
        if (!toolCalls || !toolCalls.length) break;

        for (const tc of toolCalls) {
          let resultado;
          if (requiereConfirmacion(tc.name)) {
            setMessages(prev => [...prev, { kind: 'tool', name: tc.name, args: tc.args, estado: 'pendiente' }]);
            const aceptar = await pedirConfirmacion(tc.name, tc.args);
            if (!aceptar) {
              resultado = { cancelado: true, mensaje: 'El usuario cancelo la ejecucion de esta herramienta.' };
              setMessages(prev => [...prev, { kind: 'tool', name: tc.name, args: tc.args, estado: 'cancelado' }]);
            } else {
              resultado = await ejecutarTool(tc.name, tc.args);
              const ok = !(resultado && (resultado.error || resultado.exito === false));
              setMessages(prev => [...prev, { kind: 'tool', name: tc.name, args: tc.args, estado: ok ? 'ok' : 'error', resumen: resumirResultadoTool(resultado) }]);
              if (tc.name === 'ejecutar_script_etabs' && ok) { setPythonCode(tc.args.codigo || pythonCode); setLastRunOk(true); }
            }
          } else {
            resultado = await ejecutarTool(tc.name, tc.args);
            setMessages(prev => [...prev, { kind: 'tool', name: tc.name, args: tc.args, estado: 'ok', resumen: resumirResultadoTool(resultado) }]);
          }
          historia.push({ role: 'tool', id: tc.id, name: tc.name, content: JSON.stringify(resultado).slice(0, 8000) });
        }
      }
    } catch (err) {
      const msg = err?.message || String(err);
      if (activeKeys.length > 1) setCurrentKeyIndex(prev => ({ ...prev, [activeProvider]: ((prev[activeProvider] || 0) + 1) % activeKeys.length }));
      showStatus('error', `Fallo ${activeLabel} en el modo agente.`);
      setMessages(prev => [...prev, { role: 'assistant', content: `No pude completar la tarea. Detalle: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [aiTools, activeKeys, activeModel, activeProvider, activeLabel, currentKeyIndex, getAgentSystemInstruction, llamarProveedorConTools, requiereConfirmacion, pedirConfirmacion, ejecutarTool, showStatus, pythonCode]);

  const requestAiCode = useCallback(async ({ instruction, isRepair = false, errorText = '' }) => {
    const keys = activeProvider === 'openai' ? openaiKeys : activeProvider === 'anthropic' ? anthropicKeys : geminiKeys;

    if (!activeModel) return showStatus('error', 'No hay modelo activo configurado.');
    if (!instruction?.trim() && !isRepair) return showStatus('error', 'Escribe una instruccion.');
    if (keys.length === 0) return showStatus('error', `Ingresa al menos una API Key de ${activeLabel}.`);

    setMessages(prev => [...prev, { role: 'user', content: isRepair ? `Repara el codigo usando este error:\n${errorText}` : instruction }]);
    setIsLoading(true);

    // Registrar el error pendiente: si la proxima ejecucion funciona, el par
    // error->solucion se guardara automaticamente como leccion aprendida.
    if (isRepair && errorText) {
      pendingLessonRef.current = { error: String(errorText).slice(0, 1500) };
    }

    // Buscar en la documentacion oficial los metodos relevantes a la instruccion
    // (o al error, en modo reparacion) e inyectarlos en el prompt. Ademas, leer
    // el modelo abierto para que la IA use los nombres reales.
    const docsQuery = isRepair ? `${errorText}\n${pythonCode}`.slice(0, 1500) : instruction;
    const [apiDocs, resumenModelo] = await Promise.all([fetchApiDocs(docsQuery), fetchModelSummary()]);

    const promptText = buildPrompt({ instruction, isRepair, errorText, apiDocs, modelInfo: formatModelSummary(resumenModelo) });
    const key = keys[currentKeyIndex[activeProvider] || 0];

    try {
      const raw = activeProvider === 'openai' ? await callOpenAI({ key, promptText }) : await callGemini({ key, promptText });
      const parsed = JSON.parse(extractJsonObject(raw));

      const plan = Array.isArray(parsed.execution_plan) && parsed.execution_plan.length ? `\n\nPlan:\n${parsed.execution_plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : '';
      const assumptions = Array.isArray(parsed.assumptions) && parsed.assumptions.length ? `\n\nSupuestos:\n${parsed.assumptions.map(p => `- ${p}`).join('\n')}` : '';
      const warnings = Array.isArray(parsed.warnings) && parsed.warnings.length ? `\n\nAlertas:\n${parsed.warnings.map(p => `- ${p}`).join('\n')}` : '';

      setMessages(prev => [...prev, { role: 'assistant', content: `${parsed.explanation || 'Codigo generado.'}${plan}${assumptions}${warnings}` }]);

      if (parsed.code) {
        // Composicion: la app antepone el bloque base validado segun el modo.
        const { script, usedBase } = assembleGeneratedScript({
          modeValue: sessionMode,
          unidades: Number.parseInt(selectedUnits, 10) || 6,
          modelPath: modelFilePath.trim(),
          aiCode: parsed.code
        });
        setPythonCode(script);
        setLastCodeFromAi(true);
        autoRepairUsedRef.current = false;
        const preflight = runLocalPreflight(script);
        const notaBase = usedBase
          ? 'Script ensamblado: bloque base validado (conexion) + codigo de modelado de la IA.'
          : 'AVISO: la IA devolvio un script completo en vez de construir_modelo; se usara tal cual.';
        setExecutionOutput(`${notaBase}\n\nPREFLIGHT DEL CODIGO GENERADO:\n${renderPreflight(preflight) || 'Sin errores ni advertencias.'}`);
      }
    } catch (err) {
      const msg = err?.message || String(err);
      // Rota a la siguiente API Key disponible para el proximo intento.
      if (keys.length > 1) {
        setCurrentKeyIndex(prev => ({
          ...prev,
          [activeProvider]: ((prev[activeProvider] || 0) + 1) % keys.length
        }));
      }
      showStatus('error', `Fallo ${activeLabel} o no respondio JSON valido.`);
      setExecutionOutput(`ERROR IA:\n${msg}`);
      setMessages(prev => [...prev, { role: 'assistant', content: `No pude generar codigo valido. Detalle: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [activeProvider, activeLabel, activeModel, openaiKeys, geminiKeys, currentKeyIndex, buildPrompt, showStatus, runLocalPreflight, callGemini, callOpenAI, fetchApiDocs, fetchModelSummary, pythonCode, sessionMode, selectedUnits, modelFilePath]);

  const triggerAutoRepair = useCallback((errText) => {
    // Auto-reparacion: un solo intento automatico por cada codigo generado.
    if (!autoRepair || !lastCodeFromAi || autoRepairUsedRef.current) return;
    autoRepairUsedRef.current = true;
    setMessages(prev => [...prev, { role: 'assistant', content: 'Auto-reparacion: enviando el error a la IA para corregir el codigo...' }]);
    requestAiCode({ instruction: 'Repara el codigo actual', isRepair: true, errorText: errText });
  }, [autoRepair, lastCodeFromAi, requestAiCode]);

  const buildServerPayload = useCallback((codeOverride) => {
    const unitsValue = Number.parseInt(selectedUnits, 10);
    const mode = getMode(sessionMode);
    const code = typeof codeOverride === 'string' ? codeOverride : pythonCode;

    return {
      code,
      connection_mode: mode.connection_mode,
      model_mode: mode.model_mode,
      model_path: modelFilePath.trim() || null,
      units: Number.isFinite(unitsValue) ? unitsValue : 6,
      // El codigo siempre es un script completo: se ejecuta tal cual, sin sandbox.
      strict_safety: false,
      raw_script: true,
      variables: {},
      options: {
        sessionMode,
        modelFilePath: modelFilePath.trim(),
        visibleEtabs,
        saveBeforeRun,
        selectedUnits
      }
    };
  }, [pythonCode, selectedUnits, sessionMode, modelFilePath, visibleEtabs, saveBeforeRun]);

  const executeCode = useCallback(async (codeOriginal, stepId = null) => {
    // Inyectar la instancia ETABS seleccionada (PID) en el bloque base.
    const code = instanciaPid
      ? String(codeOriginal).replace('PID_OBJETIVO = 0', `PID_OBJETIVO = ${instanciaPid}`)
      : codeOriginal;
    const preflight = runLocalPreflight(code);
    if (!preflight.ok) {
      setExecutionOutput(`PREFLIGHT FALLIDO:\n${renderPreflight(preflight)}`);
      return showStatus('error', 'Preflight con errores. No se envio a ETABS.');
    }

    setIsLoading(true);
    setExecutionOutput(`Preflight aprobado. Enviando a ${config.pythonUrl}/execute-etabs ${instanciaPid ? `(instancia PID ${instanciaPid})` : ''}...`);

    try {
      const response = await fetch(`${config.pythonUrl}/execute-etabs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildServerPayload(code))
      });

      const result = await response.json();
      if (result.success) {
        setLastError('');
        setLastRunOk(true);
        if (stepId) marcarPaso(stepId);  // marca el paso del flujo como completado
        showStatus('success', 'Codigo ejecutado en ETABS.');
        setExecutionOutput(JSON.stringify(result, null, 2));
        // Aprendizaje automatico: si veniamos de una reparacion, guardar el
        // par error->solucion como leccion para que la IA no lo repita.
        if (pendingLessonRef.current && pendingLessonRef.current.error) {
          const cuerpoMatch = code.match(/def construir_modelo[\s\S]*?(?=\ndef main\(\)|$)/);
          const solucion = (cuerpoMatch ? cuerpoMatch[0] : code).slice(0, 6000);
          const primeraLinea = pendingLessonRef.current.error.split('\n').find(l => l.trim()) || 'Error reparado';
          fetch(`${config.pythonUrl}/lecciones`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              titulo: primeraLinea.slice(0, 120),
              error: pendingLessonRef.current.error,
              solucion
            })
          })
            .then(r => r.json())
            .then(data => {
              if (data.success && Array.isArray(data.lecciones)) {
                setSavedLessons(data.lecciones);
                showStatus('success', 'Leccion aprendida guardada: este error ya no se repetira.');
              }
            })
            .catch(() => { /* sin conexion; la leccion se pierde esta vez */ });
          pendingLessonRef.current = null;
        }
      } else if (Array.isArray(result.api_method_issues) && result.api_method_issues.length) {
        // Bloqueado por validacion de API: metodos inventados, sin abrir ETABS.
        const lista = result.api_method_issues.map((m, i) => `${i + 1}. ${m}`).join('\n');
        const errText = `METODOS INEXISTENTES (bloqueado antes de abrir ETABS):\n${lista}`;
        setLastError(errText);
        setLastRunOk(false);
        showStatus('error', 'Codigo con metodos inexistentes. No se abrio ETABS.');
        setExecutionOutput(`${errText}\n\nLa IA invento estos metodos. Pulsa "Reparar con IA" o revisa el Explorador (API Docs) para el metodo correcto.`);
        triggerAutoRepair(errText);
      } else {
        const errText = JSON.stringify(result, null, 2);
        setLastError(errText);
        setLastRunOk(false);
        showStatus('error', 'Error ejecutando en ETABS.');
        setExecutionOutput(`ERROR DE PYTHON / ETABS:\n${errText}\n\nPuedes pulsar Reparar con IA.`);
        triggerAutoRepair(errText);
      }
    } catch (err) {
      const errText = `ERROR DE RED:\nNo se pudo conectar al servidor Python. Ejecuta: python etabs_server.py\n\nDetalle: ${err?.message || err}`;
      setLastError(errText);
      setLastRunOk(false);
      showStatus('error', 'No se pudo conectar al servidor.');
      setExecutionOutput(errText);
    } finally {
      setIsLoading(false);
    }
  }, [runLocalPreflight, showStatus, config.pythonUrl, buildServerPayload, triggerAutoRepair, marcarPaso, instanciaPid]);

  // Diagnostica el modelo abierto (instancia seleccionada) y auto-marca pasos.
  // Guarda los materiales detectados (para sugerirlos en los formularios) y
  // apunta las secciones/losas/muros a un concreto que SI exista en el modelo
  // (si el material actual del formulario no esta entre los detectados).
  const aplicarMaterialesDetectados = useCallback((concretos, aceros) => {
    const conc = Array.isArray(concretos) ? concretos : [];
    const ace = Array.isArray(aceros) ? aceros : [];
    setMaterialesDisponibles({ concretos: conc, aceros: ace });
    const nombres = conc.map(c => c.nombre);
    const preferido = (conc.filter(c => !c.default)[0] || conc[0] || {}).nombre;
    if (preferido) {
      const fix = setter => setter(p => (nombres.includes(p.material) ? p : { ...p, material: preferido }));
      [setVigaParams, setColParams, setLosaMacizaParams, setLosa1dParams, setLosa2dParams, setMuroDefParams].forEach(fix);
    }
  }, []);

  const handleDiagnosticar = useCallback(async (opts) => {
    // opts.abrirModal=false -> solo auto-marca pasos (lo usa "Leer modelo abierto").
    const abrirModal = !(opts && opts.abrirModal === false);
    setExecutionOutput('Diagnosticando el modelo abierto en ETABS...');
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/diagnostico?pid=${instanciaPid || 0}`);
      const data = await r.json();
      if (!data.success || !data.diagnostico) {
        setDiagData(null);
        showStatus('error', data.error || 'No se pudo diagnosticar.');
        setExecutionOutput(`No se pudo diagnosticar: ${data.error || 'sin datos'}`);
        return false;
      }
      const g = data.diagnostico;
      setDiagData(g);
      if (abrirModal) setDiagOpen(true);
      aplicarMaterialesDetectados(g.concretos, g.aceros);
      // Auto-marcar los pasos detectados como definidos en el modelo real.
      const detectados = Object.entries(g.pasos || {}).filter(([, v]) => v).map(([k]) => k);
      setStepsDone(prev => {
        const next = { ...prev };
        detectados.forEach(k => { next[k] = true; });
        return next;
      });
      showStatus('success', `Diagnostico OK: ${detectados.length} pasos detectados en el modelo.`);
      // Reporte de texto (con propiedades) tambien al terminal, por si se quiere copiar.
      const nom = (arr, f) => (arr && arr.length ? arr.map(f).join(', ') : '—');
      const sec = s => `${s.nombre} ${s.base ?? '?'}×${s.peralte ?? '?'}cm`;
      setExecutionOutput(`DIAGNOSTICO DEL MODELO "${g.modelo}":\n` +
        `Pisos: ${(g.pisos || []).join(', ') || '—'} | Ejes X: ${(g.grilla_x || []).join(', ') || '—'} | Ejes Y: ${(g.grilla_y || []).join(', ') || '—'}\n` +
        `Concretos: ${nom(g.concretos, c => `${c.nombre} (f'c=${c.fc ?? '?'}, E=${c.modulo ?? '?'})`)}\n` +
        `Aceros: ${nom(g.aceros, a => `${a.nombre} (Fy=${a.fy ?? '?'}, Fu=${a.fu ?? '?'})`)}\n` +
        `Secciones viga: ${nom(g.secciones_viga, sec)}\nSecciones columna: ${nom(g.secciones_columna, sec)}\n` +
        `Losas 1D: ${nom(g.losas_1d, l => `${l.nombre} e=${l.espesor ?? '?'}cm`)} | 2D: ${nom(g.losas_2d, l => `${l.nombre} e=${l.espesor ?? '?'}cm`)} | macizas: ${nom(g.losas_maciza, l => `${l.nombre} e=${l.espesor ?? '?'}cm`)}\n` +
        `Muros: ${nom(g.muros, m => `${m.nombre} e=${m.espesor ?? '?'}cm`)}\n` +
        `Frames dibujados: ${g.num_frames} | Areas: ${g.num_areas} | Apoyos: ${g.apoyos ? 'si' : 'no'}\n` +
        `Patrones: ${nom(g.patrones, p => `${p.nombre} (${p.tipo})`)}\nCasos: ${nom(g.casos, c => `${c.nombre} (${c.tipo})`)}\n` +
        `Combos: ${nom(g.combinaciones, c => `${c.nombre} = ${c.formula}`)}\n` +
        `Analisis corrido: ${g.analizado ? 'SI' : 'NO'}\n\nPasos auto-marcados: ${detectados.join(', ')}`);
      return true;
    } catch {
      setDiagData(null);
      showStatus('error', 'No se pudo conectar al servidor.');
      setExecutionOutput('No se pudo conectar al servidor para diagnosticar.');
      return false;
    }
  }, [config.pythonUrl, instanciaPid, showStatus, aplicarMaterialesDetectados]);

  const handleExecute = () => {
    if (sessionMode === 'code_only') return showStatus('error', 'Estas en modo solo codigo.');
    executeCode(pythonCode);
  };

  const handlePingServer = async () => {
    try {
      const response = await fetch(`${config.pythonUrl}/status`);
      const result = await response.json();
      showStatus(result.success || result.ok ? 'success' : 'error', result.message || 'Servidor respondio.');
      setExecutionOutput(`STATUS DEL SERVIDOR:\n${JSON.stringify(result, null, 2)}`);
    } catch {
      showStatus('error', 'No responde el servidor Python.');
      setExecutionOutput('No se pudo conectar al servidor Python. Ejecuta: python etabs_server_final_corregido.py');
    }
  };

  const handleTestAiModel = async () => {
    const keys = activeKeys;
    if (!activeModel) return showStatus('error', 'No hay modelo activo.');
    if (keys.length === 0) return showStatus('error', `Ingresa una API Key de ${activeLabel}.`);

    const key = keys[currentKeyIndex[activeProvider] || 0];
    setIsLoading(true);
    setExecutionOutput(`Probando ${activeLabel}: ${activeModel}...`);

    try {
      if (activeProvider === 'anthropic') {
        const response = await fetch(`${config.pythonUrl}/ai/anthropic`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, model: activeModel, messages: [{ role: 'user', content: 'Responde solo OK' }], max_tokens: 20 })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Sin respuesta del proxy.');
        const txt = (data.response?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        setExecutionOutput(`TEST OK\nProveedor: Claude\nModelo: ${activeModel}\n\nRespuesta:\n${txt}`);
      } else if (activeProvider === 'gemini') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo OK' }] }], generationConfig: { maxOutputTokens: 20, temperature: 0 } })
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text);
        setExecutionOutput(`TEST OK\nProveedor: Gemini\nModelo: ${activeModel}\n\nRespuesta:\n${text}`);
      } else {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model: activeModel, messages: [{ role: 'user', content: 'Responde solo OK' }], max_tokens: 20, temperature: 0 })
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text);
        setExecutionOutput(`TEST OK\nProveedor: OpenAI\nModelo: ${activeModel}\n\nRespuesta:\n${text}`);
      }
      showStatus('success', 'Modelo activo.');
    } catch (err) {
      setExecutionOutput(`TEST FALLIDO\nProveedor: ${activeLabel}\nModelo: ${activeModel}\n\n${err?.message || err}`);
      showStatus('error', 'Ese modelo no respondio con tu API Key.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleListModels = async () => {
    if (activeProvider === 'anthropic') {
      setExecutionOutput(`MODELOS CLAUDE SUGERIDOS:\n\n${ANTHROPIC_MODEL_OPTIONS.filter(o => o.value !== 'custom').map(o => `${o.value}  —  ${o.label}`).join('\n')}\n\n(Usa "Test modelo" para validar tu key con el modelo elegido.)`);
      return showStatus('success', 'Modelos Claude listados.');
    }
    const keys = activeProvider === 'openai' ? openaiKeys : geminiKeys;
    if (keys.length === 0) return showStatus('error', `Ingresa una API Key de ${activeLabel}.`);

    const key = keys[currentKeyIndex[activeProvider] || 0];
    setIsLoading(true);
    setExecutionOutput(`Listando modelos de ${activeLabel}...`);

    try {
      if (activeProvider === 'gemini') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result, null, 2));
        const models = Array.isArray(result.models) ? result.models : [];
        const lines = models.map(m => `${String(m.name || '').replace(/^models\//, '')}${Array.isArray(m.supportedGenerationMethods) ? ' | ' + m.supportedGenerationMethods.join(', ') : ''}`);
        setExecutionOutput(`MODELOS GEMINI DISPONIBLES:\n\n${lines.join('\n') || JSON.stringify(result, null, 2)}`);
      } else {
        const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result, null, 2));
        const models = Array.isArray(result.data) ? result.data.map(m => m.id).sort() : [];
        setExecutionOutput(`MODELOS OPENAI DISPONIBLES:\n\n${models.join('\n') || JSON.stringify(result, null, 2)}`);
      }
      showStatus('success', 'Modelos listados.');
    } catch (err) {
      setExecutionOutput(`NO SE PUDO LISTAR MODELOS:\n${err?.message || err}`);
      showStatus('error', 'No se pudo listar modelos.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChat = () => {
    const msg = chatInput.trim();
    if (!msg) return showStatus('error', 'Escribe una instruccion.');
    if (isLoading) return;
    setChatInput('');
    if (config.agentMode) runAgentChat(msg);
    else requestAiCode({ instruction: msg });
  };

  // Tab dentro del editor inserta 4 espacios (no cambia el foco), como un IDE.
  const handleEditorKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const nuevo = pythonCode.slice(0, start) + '    ' + pythonCode.slice(end);
      setPythonCode(nuevo);
      setLastRunOk(false);
      setLastCodeFromAi(false);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  };

  const handleCopyCode = async () => {
    if (!pythonCode.trim()) return showStatus('error', 'El editor esta vacio.');
    try {
      await navigator.clipboard.writeText(pythonCode);
      showStatus('success', 'Codigo copiado al portapapeles.');
    } catch {
      showStatus('error', 'No se pudo copiar (el navegador bloqueo el portapapeles).');
    }
  };

  const handleDownloadScript = () => {
    if (!pythonCode.trim()) return showStatus('error', 'El editor esta vacio.');
    const blob = new Blob([pythonCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'etabs_script.py';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showStatus('success', 'Script .py descargado. Ejecutalo con: python etabs_script.py');
  };

  // Grilla: el usuario da las LUCES (separaciones) por vano en X y Y. SIEMPRE se
  // construye con buildNonUniformGridBody (NewBlank + pisos por API + grilla por
  // tabla), tanto uniforme como no uniforme: asi NUNCA aparece la cota fantasma de
  // 1 m de NewGridOnly y el resultado es consistente (ver builder).
  const buildCurrentGridScript = () => {
    const unidades = Number.parseInt(selectedUnits, 10) || 6;
    const alturasPiso = parseAlturasPisos(gridParams.alturasPisos);
    if (!alturasPiso.length) {
      showStatus('error', 'Ingresa al menos una altura de piso. Ej: 4, 5, 5  (o con multiplicador: 4 2*5).');
      return null;
    }
    const lucesX = parseListaNumeros(gridParams.espaciamientosX).filter(n => n > 0);
    const lucesY = parseListaNumeros(gridParams.espaciamientosY).filter(n => n > 0);
    if (lucesX.length < 1 || lucesY.length < 1) {
      showStatus('error', 'Ingresa al menos una luz (separacion entre ejes) en X y en Y. Ej: 5, 4, 6');
      return null;
    }
    const body = buildNonUniformGridBody({
      alturasPiso,
      ordenadasX: ordenadasDeLuces(gridParams.espaciamientosX),
      ordenadasY: ordenadasDeLuces(gridParams.espaciamientosY),
      ejesInclinados: gridParams.ejesInclinados
    });
    return assembleScript({
      modeValue: 'start_new_instance_new_model',
      unidades, modelPath: '', body
    });
  };

  const handleInsertGrid = () => {
    const script = buildCurrentGridScript();
    if (!script) return;
    setPythonCode(script);
    setLastCodeFromAi(false);
    showStatus('success', 'Script de grilla insertado en el editor.');
  };

  const handleCreateGrid = () => {
    const script = buildCurrentGridScript();
    if (!script) return;
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'grid');
  };

  // ---- OPCIONAL: detectar los ejes de la grilla desde una IMAGEN del plano (IA visión) ----
  // Filosofia de la app: lo determinista (construir la grilla) ya es solido; la IA solo LEE
  // las luces de la imagen (tarea de percepcion) y rellena el formulario; el usuario REVISA.
  // Gemini y OpenAI se llaman directo del navegador (ambos soportan vision). Anthropic va por
  // el servidor y aqui se omite (se sugiere Gemini/OpenAI).
  const VISION_GRID_PROMPT = `Eres un asistente que LEE planos estructurales. En la imagen hay una grilla con EJES marcados por burbujas circuladas: NUMEROS en una direccion (la llamamos X) y LETRAS en la otra (Y). Entre ejes consecutivos hay cotas (dimensiones) en metros.
Devuelve SOLO un objeto JSON valido (sin texto ni markdown) con esta forma:
{"lucesX":[num,...],"lucesY":[num,...],"ejesX":["1","2",...],"ejesY":["A","B",...],"unidad":"m","confianza":0.0,"notas":"..."}
REGLAS:
- lucesX = separaciones CENTRO A CENTRO entre ejes NUMERADOS consecutivos (1->2->3...). lucesY = idem entre ejes con LETRA (A->B->C...).
- Trata la grilla como ORTOGONAL (todos los ejes paralelos). Si los ejes tienen una ligera inclinacion (las cotas de un lado y del otro NO coinciden), NO la modeles: toma SIEMPRE el lado IZQUIERDO (para lucesY) e INFERIOR (para lucesX) como referencia, y menciona la inclinacion en "notas".
- Usa las cotas de eje-a-eje. IGNORA cotas de borde/volado pequenas (p.ej. 0.30/0.35 de cara de columna) salvo que separen dos ejes reales.
- nro de lucesX = nro de ejesX - 1 ; nro de lucesY = nro de ejesY - 1.
- Si una cota es ilegible, estima por proporcion, BAJA la confianza y explicalo en notas.
- No inventes ejes sin burbuja. Responde en metros.`;

  const visionGemini = async ({ key, model, base64, mimeType }) => {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: VISION_GRID_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 4000 }
      })
    });
    if (!resp.ok) throw new Error((await resp.text()).slice(0, 600));
    const d = await resp.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const visionOpenAI = async ({ key, model, dataUrl }) => {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: VISION_GRID_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        response_format: { type: 'json_object' }, temperature: 0.1
      })
    });
    if (!resp.ok) throw new Error((await resp.text()).slice(0, 600));
    const d = await resp.json();
    return d?.choices?.[0]?.message?.content || '';
  };

  const handleDetectGridFromImage = async (file) => {
    if (!file) return;
    if (activeProvider === 'anthropic') {
      setImgGridMsg('La detección por imagen usa Gemini u OpenAI (visión). Cambia el motor en ⚙ Configuración.');
      return;
    }
    const key = activeKeys[currentKeyIndex[activeProvider] || 0];
    if (!key) { setImgGridMsg(`Configura una llave de ${activeLabel} en ⚙ Configuración para usar la visión.`); return; }
    setImgGridBusy(true);
    setImgGridMsg(`Leyendo los ejes de la imagen con ${activeLabel}…`);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('No se pudo leer la imagen.')); r.readAsDataURL(file);
      });
      const base64 = String(dataUrl).split(',')[1];
      const mimeType = file.type || 'image/png';
      const raw = activeProvider === 'openai'
        ? await visionOpenAI({ key, model: activeModel, dataUrl })
        : await visionGemini({ key, model: activeModel, base64, mimeType });
      const data = JSON.parse(String(raw).replace(/```json|```/g, '').trim());
      const lx = (data.lucesX || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
      const ly = (data.lucesY || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
      if (!lx.length && !ly.length) throw new Error('No se detectaron luces. ' + (data.notas || ''));
      if (lx.length) setGrid('espaciamientosX', lx.join(', '));
      if (ly.length) setGrid('espaciamientosY', ly.join(', '));
      const conf = Math.round((Number(data.confianza) || 0) * 100);
      const ejes = `${(data.ejesX || []).join('') || lx.length + 1} en X · ${(data.ejesY || []).join('') || ly.length + 1} en Y`;
      setImgGridMsg(`✓ Detectado (${ejes}, confianza ${conf}%): X [${lx.join(', ')}] · Y [${ly.join(', ')}] m. REVISA contra el plano y corrige si hace falta.${data.notas ? ' — ' + data.notas : ''}`);
      showStatus('success', 'Ejes detectados. Revisa los valores antes de crear la grilla.');
    } catch (e) {
      setImgGridMsg('Error al detectar: ' + (e.message || e) + '. Verifica la llave/modelo (debe soportar visión) y que la imagen sea clara.');
      showStatus('error', 'No se pudieron detectar los ejes.');
    } finally {
      setImgGridBusy(false);
    }
  };

  // ---- OPCIONAL: importar los ejes de la grilla desde un archivo CAD (DXF) ----
  // El DWG es binario/cerrado (no se puede leer); el usuario exporta a DXF (texto).
  // Parser autocontenido + heurística (parseDxfEntities/extraerEjesDeDxf). Rellena el
  // formulario incluyendo EJES INCLINADOS si los hay (el usuario revisa).
  const aplicarDxf = (segments, capa, unidad) => {
    const r = extraerEjesDeDxf(segments, { capa, unidad });
    if (r.lucesX.length) setGrid('espaciamientosX', r.lucesX.join(', '));
    if (r.lucesY.length) setGrid('espaciamientosY', r.lucesY.join(', '));
    if (r.ejesInclinados.length) setGrid('ejesInclinados', r.ejesInclinados);
    const um = unidad === 'auto' ? (r.escala === 0.001 ? 'mm→m' : r.escala === 0.01 ? 'cm→m' : 'm') : unidad;
    const ok = r.lucesX.length || r.lucesY.length || r.ejesInclinados.length;
    setDxfState(prev => ({ ...prev, capa, unidad, msg: ok
      ? `✓ ${r.diag}. Unidad: ${um}${r.extent ? ` · dibujo ${r.extent.W}×${r.extent.H}` : ''}. X [${r.lucesX.join(', ')}] · Y [${r.lucesY.join(', ')}] m${r.ejesInclinados.length ? ` · ${r.ejesInclinados.length} eje(s) inclinado(s)` : ''}. REVISA contra el plano.`
      : `No se detectaron ejes. Diagnóstico: ${r.diag}${r.extent ? ` · dibujo ${r.extent.W}×${r.extent.H}` : ''}. Elige la CAPA con más líneas de ejes (el nº va al lado) o cambia la unidad.` }));
    if (ok) {
      // La vista previa debe reflejar la grilla IMPORTADA (borra lo anterior): si el usuario
      // venía de un "Leer modelo" (fuenteGrilla='real'), la previa seguía mostrando esa grilla
      // e ignoraba las luces del DXF. Volvemos a la fuente del FORMULARIO (luces espaciamientosX/Y).
      setFuenteGrilla('uniforme');
      showStatus('success', 'Ejes importados del DXF. Revisa los valores.');
    }
  };

  const handleImportDxf = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { segments, layers, layerCounts } = parseDxfEntities(text);
      if (!segments.length) {
        setDxfState({ segments: null, layers: [], layerCounts: {}, capa: '(todas)', unidad: 'auto', msg: 'No se encontraron líneas (LINE/LWPOLYLINE/POLYLINE). Asegúrate de exportar DXF de TEXTO (ASCII), no binario, y que el dibujo tenga los ejes como líneas.' });
        return;
      }
      setDxfState({ segments, layers, layerCounts, capa: '(todas)', unidad: 'auto', msg: 'Procesando…' });
      aplicarDxf(segments, '(todas)', 'auto');
    } catch (e) {
      setDxfState(s => ({ ...s, msg: 'Error leyendo el DXF: ' + (e.message || e) }));
    }
  };

  const buildCurrentNuGridScript = () => {
    const ordenadasX = parseListaNumeros(nuGridParams.ordenadasX);
    const ordenadasY = parseListaNumeros(nuGridParams.ordenadasY);
    if (ordenadasX.length < 2 || ordenadasY.length < 2) {
      showStatus('error', 'Ingresa al menos 2 ordenadas en X y en Y (ej: 0, 2, 5).');
      return null;
    }
    const body = buildNonUniformGridBody({
      numeroPisos: Number(nuGridParams.numeroPisos) || 1,
      alturaPiso: Number(nuGridParams.alturaPiso) || 3.0,
      ordenadasX,
      ordenadasY
    });
    return assembleScript({
      modeValue: 'start_new_instance_new_model',
      unidades: Number.parseInt(selectedUnits, 10) || 6,
      modelPath: '',
      body
    });
  };

  const handleCreateNuGrid = () => {
    const script = buildCurrentNuGridScript();
    if (!script) return;
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'grid');
  };

  const handleInsertNuGrid = () => {
    const script = buildCurrentNuGridScript();
    if (!script) return;
    setPythonCode(script);
    setLastCodeFromAi(false);
    showStatus('success', 'Script de grilla no uniforme insertado en el editor.');
  };

  const setNuGrid = (field, value) => setNuGridParams(prev => ({ ...prev, [field]: value }));

  const setGrid = (field, value) => setGridParams(prev => ({ ...prev, [field]: value }));

  // Ejes inclinados (array): agregar / editar un campo / quitar uno.
  const addEjeInclinado = () => setGridParams(prev => {
    const lista = prev.ejesInclinados || [];
    return { ...prev, ejesInclinados: [...lista, { id: `EI${lista.length + 1}`, x1: '0', y1: '0', x2: '', y2: '', bubble: 'Start' }] };
  });
  const setEjeInclinado = (idx, field, value) => setGridParams(prev => ({
    ...prev,
    ejesInclinados: (prev.ejesInclinados || []).map((e, i) => i === idx ? { ...e, [field]: value } : e)
  }));
  const removeEjeInclinado = (idx) => setGridParams(prev => ({
    ...prev,
    ejesInclinados: (prev.ejesInclinados || []).filter((_, i) => i !== idx)
  }));

  // Materiales y secciones trabajan sobre el modelo ACTUAL (no reinicializan).
  const buildCurrentMaterialScript = () => assembleScript({
    modeValue: 'feed_current_model',
    unidades: Number.parseInt(selectedUnits, 10) || 6,
    modelPath: '',
    body: buildMaterialConcreteBody({
      nombre: (matParams.nombre || 'CONC_FC210').trim(),
      fc: Number(matParams.fc) || 210,
      peso: Number(matParams.peso) || 2400
    })
  });

  const handleCreateMaterial = () => {
    const script = buildCurrentMaterialScript();
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'material');
  };

  const handleInsertMaterial = () => {
    setPythonCode(buildCurrentMaterialScript());
    setLastCodeFromAi(false);
    showStatus('success', 'Script de material insertado en el editor.');
  };

  const buildCurrentVigaScript = () => assembleScript({
    modeValue: 'feed_current_model',
    unidades: Number.parseInt(selectedUnits, 10) || 6,
    modelPath: '',
    body: buildBeamSectionBody({
      nombre: (vigaParams.nombre || 'V30X60').trim(),
      material: (vigaParams.material || 'CONC_FC210').trim(),
      baseCm: Number(vigaParams.baseCm) || 30,
      alturaCm: Number(vigaParams.alturaCm) || 60,
      matRefuerzo: (vigaParams.matRefuerzo || 'A615Gr60').trim(),
      recubCm: Number(vigaParams.recubCm) || 4
    })
  });

  const handleCreateViga = () => {
    const script = buildCurrentVigaScript();
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'viga');
  };

  const handleInsertViga = () => {
    setPythonCode(buildCurrentVigaScript());
    setLastCodeFromAi(false);
    showStatus('success', 'Script de seccion de viga insertado en el editor.');
  };

  const buildCurrentColScript = () => assembleScript({
    modeValue: 'feed_current_model',
    unidades: Number.parseInt(selectedUnits, 10) || 6,
    modelPath: '',
    body: buildColumnSectionBody({
      nombre: (colParams.nombre || 'C40X40').trim(),
      material: (colParams.material || 'CONC_FC210').trim(),
      baseCm: Number(colParams.baseCm) || 40,
      alturaCm: Number(colParams.alturaCm) || 40,
      matRefuerzo: (colParams.matRefuerzo || 'A615Gr60').trim(),
      recubCm: Number(colParams.recubCm) || 4,
      barras3: Number(colParams.barras3) || 3,
      barras2: Number(colParams.barras2) || 3,
      barraLong: (colParams.barraLong || '20').trim(),
      barraEstribo: (colParams.barraEstribo || '10').trim(),
      espEstriboCm: Number(colParams.espEstriboCm) || 15
    })
  });

  const handleCreateCol = () => {
    const script = buildCurrentColScript();
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'columna');
  };

  const handleInsertCol = () => {
    setPythonCode(buildCurrentColScript());
    setLastCodeFromAi(false);
    showStatus('success', 'Script de seccion de columna insertado en el editor.');
  };

  const setMat = (field, value) => setMatParams(prev => ({ ...prev, [field]: value }));
  const setViga = (field, value) => setVigaParams(prev => ({ ...prev, [field]: value }));
  const setCol = (field, value) => setColParams(prev => ({ ...prev, [field]: value }));
  const setDraw = (field, value) => setDrawParams(prev => ({ ...prev, [field]: value }));

  const buildCurrentDrawScript = () => assembleScript({
    modeValue: 'feed_current_model',
    unidades: Number.parseInt(selectedUnits, 10) || 6,
    modelPath: '',
    body: buildDrawFramesBody({
      seccionColumna: (drawParams.seccionColumna || 'C40X40').trim(),
      seccionViga: (drawParams.seccionViga || 'V30X60').trim(),
      vigasX: Boolean(drawParams.vigasX),
      vigasY: Boolean(drawParams.vigasY)
    })
  });

  const handleCreateDraw = () => {
    const script = buildCurrentDrawScript();
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'porticos');
  };

  const handleInsertDraw = () => {
    setPythonCode(buildCurrentDrawScript());
    setLastCodeFromAi(false);
    showStatus('success', 'Script de dibujo de porticos insertado en el editor.');
  };

  const buildCurrentApoyosScript = () => assembleScript({
    modeValue: 'feed_current_model',
    unidades: Number.parseInt(selectedUnits, 10) || 6,
    modelPath: '',
    body: buildSupportsBody({ empotrado: Boolean(apoyoEmpotrado) })
  });

  const handleCreateApoyos = () => {
    const script = buildCurrentApoyosScript();
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'apoyos');
  };

  const handleInsertApoyos = () => {
    setPythonCode(buildCurrentApoyosScript());
    setLastCodeFromAi(false);
    showStatus('success', 'Script de apoyos insertado en el editor.');
  };

  const buildCurrentPatternsScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildLoadPatternsBody({ incluirCE: Boolean(patParams.incluirCE) })
  });
  const handleCreatePatterns = () => { const s = buildCurrentPatternsScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'patrones'); };
  const handleInsertPatterns = () => { setPythonCode(buildCurrentPatternsScript()); setLastCodeFromAi(false); showStatus('success', 'Script de patrones insertado.'); };

  const buildCurrentCombosScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildLoadCombosBody({
      incluirCE: Boolean(comboParams.incluirCE),
      incluirSismo: Boolean(comboParams.incluirSismo),
      casoSismoX: (comboParams.casoSismoX || 'CSX').trim(),
      casoSismoY: (comboParams.casoSismoY || 'CSY').trim(),
      factorDerivaX: Number(comboParams.factorDerivaX) || 4.335,
      factorDerivaY: Number(comboParams.factorDerivaY) || Number(comboParams.factorDerivaX) || 4.335
    })
  });
  const handleCreateCombos = () => { const s = buildCurrentCombosScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'combos'); };
  const handleInsertCombos = () => { setPythonCode(buildCurrentCombosScript()); setLastCodeFromAi(false); showStatus('success', 'Script de combinaciones insertado.'); };

  const setPat = (field, value) => setPatParams(prev => ({ ...prev, [field]: value }));
  const setCombo = (field, value) => setComboParams(prev => ({ ...prev, [field]: value }));

  // ----- Losas, cargas y espectro (v2.2.0, validados en vivo) -----
  const buildCurrentLosaMacizaScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSlabSolidBody({
      nombre: (losaMacizaParams.nombre || 'LM_H20').trim(),
      material: (losaMacizaParams.material || 'CONC_FC210').trim(),
      espesorCm: Number(losaMacizaParams.espesorCm) || 20
    })
  });
  const handleCreateLosaMaciza = () => { const s = buildCurrentLosaMacizaScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'losamaciza'); };
  const handleInsertLosaMaciza = () => { setPythonCode(buildCurrentLosaMacizaScript()); setLastCodeFromAi(false); showStatus('success', 'Script de losa maciza insertado.'); };

  const buildCurrentLosa1dScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSlabRibbedBody({
      nombre: (losa1dParams.nombre || 'LA1D_H25').trim(),
      material: (losa1dParams.material || 'CONC_FC210').trim(),
      peralteCm: Number(losa1dParams.peralteCm) || 25,
      losaCm: Number(losa1dParams.losaCm) || 5,
      viguetaSupCm: Number(losa1dParams.viguetaSupCm) || 10,
      viguetaInfCm: Number(losa1dParams.viguetaInfCm) || 10,
      separacionCm: Number(losa1dParams.separacionCm) || 40,
      paralelo: Number(losa1dParams.paralelo) === 2 ? 2 : 1
    })
  });
  const handleCreateLosa1d = () => { const s = buildCurrentLosa1dScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'losa1d'); };
  const handleInsertLosa1d = () => { setPythonCode(buildCurrentLosa1dScript()); setLastCodeFromAi(false); showStatus('success', 'Script de losa aligerada 1D insertado.'); };

  const buildCurrentLosa2dScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSlabWaffleBody({
      nombre: (losa2dParams.nombre || 'LA2D_H20').trim(),
      material: (losa2dParams.material || 'CONC_FC210').trim(),
      peralteCm: Number(losa2dParams.peralteCm) || 20,
      losaCm: Number(losa2dParams.losaCm) || 5,
      nervioSupCm: Number(losa2dParams.nervioSupCm) || 10,
      nervioInfCm: Number(losa2dParams.nervioInfCm) || 10,
      separacionXCm: Number(losa2dParams.separacionXCm) || 50,
      separacionYCm: Number(losa2dParams.separacionYCm) || 50
    })
  });
  const handleCreateLosa2d = () => { const s = buildCurrentLosa2dScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'losa2d'); };
  const handleInsertLosa2d = () => { setPythonCode(buildCurrentLosa2dScript()); setLastCodeFromAi(false); showStatus('success', 'Script de losa aligerada 2D insertado.'); };

  const buildCurrentDrawSlabScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildDrawSlabBody({ seccionLosa: (drawSlabParams.seccionLosa || 'LA1D_H25').trim() })
  });
  const handleCreateDrawSlab = () => { const s = buildCurrentDrawSlabScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'dibujarlosa'); };
  const handleInsertDrawSlab = () => { setPythonCode(buildCurrentDrawSlabScript()); setLastCodeFromAi(false); showStatus('success', 'Script de dibujo de losa insertado.'); };

  const buildCurrentBeamLoadsScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildBeamLoadsBody({
      cargaCM: Number(beamLoadParams.cargaCM) || 0,
      cargaCV: Number(beamLoadParams.cargaCV) || 0,
      filtroSeccion: (beamLoadParams.filtroSeccion || '').trim(),
      reemplazar: Boolean(beamLoadParams.reemplazar)
    })
  });
  const handleCreateBeamLoads = () => { const s = buildCurrentBeamLoadsScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'cargaviga'); };
  const handleInsertBeamLoads = () => { setPythonCode(buildCurrentBeamLoadsScript()); setLastCodeFromAi(false); showStatus('success', 'Script de cargas en vigas insertado.'); };

  const buildCurrentSlabLoadsScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSlabLoadsBody({
      cargaCM: Number(slabLoadParams.cargaCM) || 0,
      cargaCV: Number(slabLoadParams.cargaCV) || 0,
      filtroPropiedad: (slabLoadParams.filtroPropiedad || '').trim(),
      reemplazar: Boolean(slabLoadParams.reemplazar)
    })
  });
  const handleCreateSlabLoads = () => { const s = buildCurrentSlabLoadsScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'asignar'); };
  const handleInsertSlabLoads = () => { setPythonCode(buildCurrentSlabLoadsScript()); setLastCodeFromAi(false); showStatus('success', 'Script de cargas en losa insertado.'); };

  const buildCurrentEspectroScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSpectrumBody({
      nombreFuncion: (espectroParams.nombreFuncion || 'E030_XY').trim(),
      z: Number(espectroParams.z) || 0.45,
      u: Number(espectroParams.u) || 1.0,
      s: Number(espectroParams.s) || 1.0,
      tp: Number(espectroParams.tp) || 0.6,
      tl: Number(espectroParams.tl) || 2.0,
      r: Number(espectroParams.r) || 8,
      casoModal: (espectroParams.casoModal || 'Modal').trim(),
      modosMin: Number(espectroParams.modosMin) || 3,
      modosMax: Number(espectroParams.modosMax) || 17,
      masaCM: Number(espectroParams.masaCM) || 1.0,
      masaCV: Number(espectroParams.masaCV) || 0,
      casoX: (espectroParams.casoX || 'CSX').trim(),
      casoY: (espectroParams.casoY || 'CSY').trim(),
      sfX: Number(espectroParams.sfX) || 1.0,
      sfY: Number(espectroParams.sfY) || 1.0,
      orto30: Boolean(espectroParams.orto30)
    })
  });
  const handleCreateEspectro = () => { const s = buildCurrentEspectroScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'espectro'); };
  const handleInsertEspectro = () => { setPythonCode(buildCurrentEspectroScript()); setLastCodeFromAi(false); showStatus('success', 'Script de espectro E.030 insertado.'); };

  const buildCurrentMassSourceScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildMassSourceBody({
      masaCM: Number(espectroParams.masaCM) || 1.0,
      masaCV: Number(espectroParams.masaCV) || 0,
      incluirElementos: Boolean(massSourceParams.incluirElementos),
      patronCM: (massSourceParams.patronCM || 'CM').trim(),
      patronCV: (massSourceParams.patronCV || 'CV').trim()
    })
  });
  const handleCreateMassSource = () => { const s = buildCurrentMassSourceScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'masssource'); };
  const handleInsertMassSource = () => { setPythonCode(buildCurrentMassSourceScript()); setLastCodeFromAi(false); showStatus('success', 'Script de mass source insertado.'); };

  const buildCurrentAutomeshScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildAutomeshBody({ soloTipo: automeshParams.soloTipo || 'todas', maxSize: automeshParams.maxSize, atGrids: automeshParams.atGrids })
  });
  const handleCreateAutomesh = () => { const s = buildCurrentAutomeshScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'automesh'); };
  const handleInsertAutomesh = () => { setPythonCode(buildCurrentAutomeshScript()); setLastCodeFromAi(false); showStatus('success', 'Script de automesh insertado.'); };

  const buildCurrentDiafragmaScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildDiaphragmBody({ nombre: diafragmaParams.nombre, semiRigido: diafragmaParams.semiRigido, alcance: diafragmaParams.alcance, pisos: diafragmaParams.pisos })
  });
  const handleCreateDiafragma = () => { const s = buildCurrentDiafragmaScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'diafragma'); };
  const handleInsertDiafragma = () => { setPythonCode(buildCurrentDiafragmaScript()); setLastCodeFromAi(false); showStatus('success', 'Script de diafragma insertado.'); };
  // Diagnostico (solo lectura): NO marca el paso como hecho (executeCode sin stepId).
  const handleCheckDiafragma = () => {
    const s = assembleScript({ modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '', body: buildDiaphragmCheckBody() });
    setPythonCode(s); setLastCodeFromAi(false); executeCode(s);
  };

  const buildCurrentEndOffsetScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildEndOffsetBody({ tipo: endOffsetParams.tipo, auto: endOffsetParams.auto, rzFactor: endOffsetParams.rzFactor, lenI: endOffsetParams.lenI, lenJ: endOffsetParams.lenJ })
  });
  const handleCreateEndOffset = () => { const s = buildCurrentEndOffsetScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'endoffset'); };
  const handleInsertEndOffset = () => { setPythonCode(buildCurrentEndOffsetScript()); setLastCodeFromAi(false); showStatus('success', 'Script de end length offset insertado.'); };

  const buildCurrentReleaseScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildReleaseBody({ alcance: releaseParams.alcance, soloVigas: releaseParams.soloVigas, filtroSeccion: releaseParams.filtroSeccion, m3i: releaseParams.m3i, m3j: releaseParams.m3j, m2i: releaseParams.m2i, m2j: releaseParams.m2j, torsionJ: releaseParams.torsionJ })
  });
  const handleCreateRelease = () => { const s = buildCurrentReleaseScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'release'); };
  const handleInsertRelease = () => { setPythonCode(buildCurrentReleaseScript()); setLastCodeFromAi(false); showStatus('success', 'Script de release insertado.'); };
  // Diagnostico (solo lectura): cuenta las vigas seleccionadas en ETABS. NO marca el paso.
  const handleCheckRelease = () => {
    const s = assembleScript({ modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '', body: buildReleaseCheckBody() });
    setPythonCode(s); setLastCodeFromAi(false); executeCode(s);
  };

  const buildCurrentAnalyzeScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildAnalyzeBody({ rutaGuardado: (analizarParams.rutaGuardado || '').trim(), nombreProyecto: proyecto })
  });
  const handleCreateAnalyze = () => { const s = buildCurrentAnalyzeScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'analizar'); };
  const handleInsertAnalyze = () => { setPythonCode(buildCurrentAnalyzeScript()); setLastCodeFromAi(false); showStatus('success', 'Script de analisis insertado.'); };

  // 2DO ANALISIS: compone espectro + combos + analisis con los params ACTUALES (ya auto-vinculados
  // al R corregido por sistema+irregularidades) y los corre en secuencia tras desbloquear.
  const buildCurrentSegundoAnalisisScript = () => {
    const esp = buildSpectrumBody({
      nombreFuncion: (espectroParams.nombreFuncion || 'E030_XY').trim(),
      z: Number(espectroParams.z) || 0.45, u: Number(espectroParams.u) || 1.0, s: Number(espectroParams.s) || 1.0,
      tp: Number(espectroParams.tp) || 0.6, tl: Number(espectroParams.tl) || 2.0, r: Number(espectroParams.r) || 8,
      casoModal: (espectroParams.casoModal || 'Modal').trim(), modosMin: Number(espectroParams.modosMin) || 3, modosMax: Number(espectroParams.modosMax) || 17,
      masaCM: Number(espectroParams.masaCM) || 1.0, masaCV: Number(espectroParams.masaCV) || 0,
      casoX: (espectroParams.casoX || 'CSX').trim(), casoY: (espectroParams.casoY || 'CSY').trim(),
      sfX: Number(espectroParams.sfX) || 1.0, sfY: Number(espectroParams.sfY) || 1.0, orto30: Boolean(espectroParams.orto30)
    });
    const com = buildLoadCombosBody({
      incluirCE: Boolean(comboParams.incluirCE), incluirSismo: Boolean(comboParams.incluirSismo),
      casoSismoX: (comboParams.casoSismoX || 'CSX').trim(), casoSismoY: (comboParams.casoSismoY || 'CSY').trim(),
      factorDerivaX: Number(comboParams.factorDerivaX) || 4.335,
      factorDerivaY: Number(comboParams.factorDerivaY) || Number(comboParams.factorDerivaX) || 4.335
    });
    const ana = buildAnalyzeBody({ rutaGuardado: (analizarParams.rutaGuardado || '').trim(), nombreProyecto: proyecto });
    return assembleScript({
      modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
      body: buildSegundoAnalisisBody(esp, com, ana)
    });
  };
  const handleCreateAnalyze2 = () => { const s = buildCurrentSegundoAnalisisScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'analizar2'); };
  const handleInsertAnalyze2 = () => { setPythonCode(buildCurrentSegundoAnalisisScript()); setLastCodeFromAi(false); showStatus('success', 'Script del 2do analisis insertado.'); };
  // Abre el explorador NATIVO "Guardar como" (lo abre el servidor local) y pone la
  // ruta elegida en el campo. El dialogo aparece en TU maquina (la del servidor).
  const handleElegirRutaEdb = async () => {
    setExaminandoRuta(true);
    showStatus('success', 'Abriendo el explorador en tu maquina (puede aparecer detras de la ventana del navegador)...');
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/elegir-ruta-edb?nombre=${encodeURIComponent(proyecto || 'modelo')}`);
      const d = await r.json();
      if (d.success && d.ruta) {
        setAnalizarParams({ rutaGuardado: d.ruta });
        showStatus('success', `Ruta elegida: ${d.ruta}`);
      } else if (d.success) {
        showStatus('error', 'No elegiste ninguna ruta (se cancelo el dialogo).');
      } else {
        showStatus('error', d.error || 'No se pudo abrir el explorador.');
      }
    } catch {
      showStatus('error', 'No se pudo conectar al servidor Python (reinicia INICIAR TODO.bat si el banner esta rojo).');
    }
    setExaminandoRuta(false);
  };

  const handleLeerResultados = async () => {
    setResLoading(true);
    setResError('');
    try {
      const q = new URLSearchParams({
        derivas: (resParams.derivas || 'DERVX,DERVY').trim(),
        limite: String(Number(resParams.limite) || 0.007),
        cortantes: (resParams.cortantes || 'CM,CV,CSX,CSY').trim(),
        modal: (resParams.modal || 'Modal').trim(),
        desplaz: (resParams.desplaz || 'CSX,CSY').trim(),
        pid: String(instanciaPid || 0)
      });
      const response = await fetch(`${config.pythonUrl}/etabs/resultados?${q.toString()}`);
      const data = await response.json();
      if (data.success && data.resultados) {
        setResData(data.resultados);
        showStatus('success', 'Resultados leidos del modelo analizado.');
      } else {
        setResData(null);
        setResError(data.error || 'No se pudieron leer los resultados.');
      }
    } catch {
      setResData(null);
      setResError('No se pudo conectar al servidor Python (reinicia INICIAR TODO.bat si el banner esta rojo).');
    }
    setResLoading(false);
  };
  const setRes = (field, value) => setResParams(prev => ({ ...prev, [field]: value }));
  const setOs = (field, value) => setOsParams(prev => ({ ...prev, [field]: value }));

  // Construye, de forma DETERMINISTA, el modelo equivalente para OpenSees usando
  // LOS MISMOS DATOS que van a ETABS: f'c (matParams), seccion de columna (colParams)
  // y de viga (vigaParams), y la MASA SISMICA derivada de TUS cargas (losa/viga CM/CV
  // + peso propio) por la fuente de masa (masaCM, masaCV de espectroParams). Geometria:
  // columnas en cada interseccion de la grilla + vigas por linea de eje (como "dibujar
  // porticos"). Diafragma rigido por piso. Unidades kN-m-ton.
  const buildOpenSeesSpec = () => {
    const xs = (ordsPreview.x || []).map(Number);
    const ys = (ordsPreview.y || []).map(Number);
    const zs = (nivelesPreview || []).map(Number);   // [0, z1, z2, ...]
    if (xs.length < 1 || ys.length < 1 || zs.length < 2) return null;
    const nx = xs.length, ny = ys.length;
    const pesoConc = Number(matParams.peso) || 2400;  // kgf/m3 (peso del concreto, matParams)
    const fc = Number(matParams.fc) || 210;           // f'c real (matParams)
    const E = 15000 * Math.sqrt(fc) * 98.0665;        // kgf/cm2 -> kN/m2
    const Gm = E / 2.4;                                // nu = 0.2
    const sec = (bcm, hcm) => {
      const b = (Number(bcm) || 0) / 100, h = (Number(hcm) || 0) / 100;   // cm -> m
      const A = b * h;
      const Iy = b * Math.pow(h, 3) / 12;
      const Iz = h * Math.pow(b, 3) / 12;
      return { A, props: [A, E, Gm, Iy + Iz, Iy, Iz] };   // J polar aprox (elastico)
    };
    const col = sec(colParams.baseCm, colParams.alturaCm);   // seccion real de columna
    const vig = sec(vigaParams.baseCm, vigaParams.alturaCm); // seccion real de viga
    const colS = col.props, vigS = vig.props;
    const id = {};
    const nodes = [];
    let c = 1;
    zs.forEach((z, k) => xs.forEach((x, ix) => ys.forEach((y, iy) => {
      id[`${ix},${iy},${k}`] = c; nodes.push([c, x, y, z]); c++;
    })));
    const supports = [];
    xs.forEach((_, ix) => ys.forEach((_, iy) => supports.push(id[`${ix},${iy},0`])));
    const columns = [], beams = [];
    for (let k = 0; k < zs.length - 1; k++)
      xs.forEach((_, ix) => ys.forEach((_, iy) =>
        columns.push([id[`${ix},${iy},${k}`], id[`${ix},${iy},${k + 1}`], ...colS])));
    for (let k = 1; k < zs.length; k++) {
      ys.forEach((_, iy) => { for (let ix = 0; ix < xs.length - 1; ix++) beams.push([id[`${ix},${iy},${k}`], id[`${ix + 1},${iy},${k}`], ...vigS]); });
      xs.forEach((_, ix) => { for (let iy = 0; iy < ys.length - 1; iy++) beams.push([id[`${ix},${iy},${k}`], id[`${ix},${iy + 1},${k}`], ...vigS]); });
    }
    // LOSAS membrana: una cáscara ShellMITC4 por paño de la grilla (reusa los 4 nudos
    // de las esquinas, sin mallar). El diafragma rígido gobierna el plano (como ETABS
    // losa membrana + diafragma); la masa sigue concentrada por piso (rho=0, sin doble conteo).
    const slabs = [];
    for (let k = 1; k < zs.length; k++)
      for (let ix = 0; ix < nx - 1; ix++)
        for (let iy = 0; iy < ny - 1; iy++)
          slabs.push([id[`${ix},${iy},${k}`], id[`${ix + 1},${iy},${k}`], id[`${ix + 1},${iy + 1},${k}`], id[`${ix},${iy + 1},${k}`]]);
    // --- MASA SISMICA por piso (de TUS cargas, como la fuente de masa de ETABS) ---
    const Xtot = (Math.max(...xs) - Math.min(...xs)) || 0;
    const Ytot = (Math.max(...ys) - Math.min(...ys)) || 0;
    const area = Math.max(0.0001, Xtot * Ytot);          // m2 (planta)
    const Lb = Xtot * ny + Ytot * nx;                     // longitud total de vigas/piso (m)
    // peso propio de la losa ACTIVA (kgf/m2), segun su tipo y dimensiones reales
    const slabW = (() => {
      const nm = drawSlabParams.seccionLosa;
      if (nm === losa1dParams.nombre) {
        const t = (Number(losa1dParams.losaCm) || 5) / 100, hp = (Number(losa1dParams.peralteCm) || 25) / 100;
        const bw = (((Number(losa1dParams.viguetaSupCm) || 10) + (Number(losa1dParams.viguetaInfCm) || 10)) / 2) / 100;
        const sp = (Number(losa1dParams.separacionCm) || 40) / 100;
        return (t + (hp - t) * (bw / sp)) * pesoConc;      // aligerada 1D (nervios en 1 dir)
      }
      if (nm === losa2dParams.nombre) {
        const t = (Number(losa2dParams.losaCm) || 5) / 100, hp = (Number(losa2dParams.peralteCm) || 20) / 100;
        const bw = (((Number(losa2dParams.nervioSupCm) || 10) + (Number(losa2dParams.nervioInfCm) || 10)) / 2) / 100;
        const spx = (Number(losa2dParams.separacionXCm) || 50) / 100, spy = (Number(losa2dParams.separacionYCm) || 50) / 100;
        return (t + (hp - t) * (bw / spx + bw / spy)) * pesoConc;   // waffle (nervios 2 dir)
      }
      return ((Number(losaMacizaParams.espesorCm) || 20) / 100) * pesoConc;   // maciza (o fallback)
    })();
    const slabCM = Number(slabLoadParams.cargaCM) || 0;   // kgf/m2 (carga muerta superpuesta)
    const slabCV = Number(slabLoadParams.cargaCV) || 0;   // kgf/m2 (carga viva)
    const beamCM = Number(beamLoadParams.cargaCM) || 0;   // kgf/m
    const beamCV = Number(beamLoadParams.cargaCV) || 0;   // kgf/m
    const beamSelf = Lb * vig.A * pesoConc;               // kgf (peso propio de vigas/piso)
    const fCM = Number(espectroParams.masaCM) || 1.0;     // fuente de masa
    const fCV = Number(espectroParams.masaCV) || 0.5;
    const stories = [], masas_piso = {};
    let masaTot = 0, pesoMuertoKgf = 0, pesoVivoKgf = 0;
    for (let k = 1; k < zs.length; k++) {
      const snodes = [];
      xs.forEach((_, ix) => ys.forEach((_, iy) => snodes.push(id[`${ix},${iy},${k}`])));
      const hBelow = zs[k] - zs[k - 1];
      const hAbove = k < zs.length - 1 ? zs[k + 1] - zs[k] : 0;
      const colSelf = nx * ny * col.A * pesoConc * (hBelow / 2 + hAbove / 2);  // kgf (col tributaria)
      const Wcm = beamSelf + colSelf + (slabW + slabCM) * area + beamCM * Lb;  // peso muerto (kgf)
      const Wcv = slabCV * area + beamCV * Lb;             // peso vivo (kgf)
      const masa = (fCM * Wcm + fCV * Wcv) / 1000;         // kgf -> ton (masa sismica)
      const nombre = `N${k}`;
      stories.push({ nombre, z: zs[k], h: hBelow, nodes: snodes });
      masas_piso[nombre] = masa;
      masaTot += masa;
      pesoMuertoKgf += Wcm;
      pesoVivoKgf += Wcv;
    }
    // ESPECTRO: DIRECTO de la pestaña "El Espectro de Diseño" (disenoEspectro). Usa las
    // DOS curvas SaX (R=Rx) y SaY (R=Ry) tal cual las calcula esa pestaña → espectros
    // DISTINTOS por dirección. Es la fuente de verdad sísmica (no se recalcula aparte).
    const d = calcEspectroDiseno(disenoEspectro);
    const spectrum = d.valido
      ? { T: d.puntos.map(p => p.t), SaX: d.puntos.map(p => p.sax), SaY: d.puntos.map(p => p.say) }
      : null;
    // Sección de placa membrana: espesor equivalente (peso propio/γ → m), ρ=0 (la masa va
    // concentrada por piso, sin doble conteo). E del concreto, ν=0.2.
    const hEq = Math.max(0.02, slabW / (pesoConc || 2400));   // m (espesor equiv. del tipo de losa)
    const slab_section = { E, nu: 0.2, h: hEq, rho: 0 };
    // Modo de losa: 'diafragma' (membrana fiel en 3D = SOLO diafragma rígido, sin elemento de
    // área; el modelo validado T1=0.576) | 'shell' (cáscara ShellMITC4 real, que en OpenSees
    // trae rigidez de placa → se comporta como shell-thin y rigidiza). Por defecto diafragma.
    const usaShell = osParams.modeloLosa === 'shell';
    return {
      nodes, supports, stories, columns, beams,
      slabs: usaShell ? slabs : [], slab_section: usaShell ? slab_section : null,
      masas_piso, spectrum,
      nmodes: Number(osParams.nmodes) || 12,
      _meta: {
        nejes: `${nx}×${ny}`, npisos: zs.length - 1, area, Rx: d.Rx, Ry: d.Ry, valido: true,
        modeloLosa: usaShell ? 'shell' : 'diafragma', nLosas: usaShell ? slabs.length : 0,
        nBaysLosa: slabs.length, losaTipo: drawSlabParams.seccionLosa, hEqLosa: hEq,
        fc, colSec: `${colParams.baseCm}×${colParams.alturaCm}`, vigaSec: `${vigaParams.baseCm}×${vigaParams.alturaCm}`,
        losa: drawSlabParams.seccionLosa, slabW: Math.round(slabW),
        masaPiso: (zs.length - 1) > 0 ? masaTot / (zs.length - 1) : 0, masaTot,
        pesoMuertoTon: pesoMuertoKgf / 1000, pesoVivoTon: pesoVivoKgf / 1000, pesoSismicoTon: masaTot, fCM, fCV,
        espectro: `El Espectro de Diseño · Z=${d.Z} U=${d.U} S=${d.S} TP=${d.TP} TL=${d.TL} · R-X=${d.Rx.toFixed(2)} (SaX) / R-Y=${d.Ry.toFixed(2)} (SaY)`,
        cargas: `losa CM ${slabCM}/CV ${slabCV} kgf/m² · viga CM ${beamCM} kgf/m · masa ${fCM}·CM+${fCV}·CV`,
      },
    };
  };

  const verificarOpenSees = async () => {
    const full = buildOpenSeesSpec();
    if (!full) { setOsError('Falta la grilla o los pisos. Define la grilla (o "Leer de ETABS" en el Modelador) primero.'); return; }
    const { _meta, ...spec } = full;
    setOsLoading(true); setOsError('');
    try {
      const r = await fetch(`${config.pythonUrl}/opensees/verificar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, timeout: 240 }),
      });
      const data = await r.json();
      if (data.ok) {
        setOsData({ ...data, _meta });
        showStatus('success', `OpenSees: T1=${Number(data.T1).toFixed(3)} s · masa X=${Number(data.modal.masa_x_pct).toFixed(0)}%.`);
      } else {
        setOsData(null);
        setOsError(data.error || 'OpenSees no devolvio resultados. ¿Reiniciaste el servidor tras subir a v1.26.0?');
      }
    } catch {
      setOsData(null);
      setOsError('No se pudo conectar al servidor Python (revisa el banner rojo / reinicia INICIAR TODO.bat).');
    }
    setOsLoading(false);
  };

  // Extrae del modelo REAL de ETABS conteos, secciones (con A/E/I), losas (con shell)
  // y masas por piso, para compararlos con el modelo OpenSees.
  const extraerModeloEtabs = async () => {
    setEtabsModeloLoading(true); setEtabsModeloError('');
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/extraer-modelo?pid=${instanciaPid || 0}`);
      const data = await r.json();
      if (data.ok) {
        setEtabsModelo(data);
        showStatus('success', `Extraído de ETABS: ${data.conteo?.columna || 0} col · ${data.conteo?.viga || 0} vigas · ${data.conteo?.losa || 0} losas.`);
      } else {
        setEtabsModelo(null);
        setEtabsModeloError(data.error || 'No se pudo extraer el modelo de ETABS.');
      }
    } catch {
      setEtabsModelo(null);
      setEtabsModeloError('No se pudo conectar al servidor (¿reiniciaste tras subir a v1.27.0?).');
    }
    setEtabsModeloLoading(false);
  };

  // ----- Pestaña "Flujo OpenSees": datos colocados + traza de comandos ejecutados -----
  const renderOpenSees = () => {
    const cardCls = 'bg-white/[0.025] border border-white/[0.07] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.35)]';
    const tituloCls = 'text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-2';
    const meta = (buildOpenSeesSpec() || {})._meta;
    const dz = osData?.datos || {};
    const script = osData?.script || [];
    // Factor de amplificacion de deriva (E.030): 0.75R si la estructura es REGULAR,
    // 0.85R si es IRREGULAR (lo definen las irregularidades Ia/Ip del espectro), con
    // R = R0*Ia*Ip de CADA direccion (del Espectro de Diseno: Rx, Ry; pueden diferir).
    // Para la comparacion se usa el MISMO factor que ETABS (comboParams.factorDerivaX/Y,
    // el SF de DERVX/DERVY) y se VERIFICA contra el teorico por direccion.
    const dEspReg = calcEspectroDiseno(disenoEspectro);
    const esIrregular = dEspReg.Iax < 1 || dEspReg.Iay < 1 || dEspReg.Ipx < 1 || dEspReg.Ipy < 1;
    const facReg = esIrregular ? 0.85 : 0.75;
    const RxDer = dEspReg.Rx, RyDer = dEspReg.Ry;                 // R = R0*Ia*Ip por direccion
    const factorTeoricoX = facReg * RxDer, factorTeoricoY = facReg * RyDer;
    const ampX = Number(comboParams.factorDerivaX) || factorTeoricoX;   // SF de ETABS DERVX
    const ampY = Number(comboParams.factorDerivaY) || factorTeoricoY;   // SF de ETABS DERVY
    const factorOKX = Math.abs(ampX - factorTeoricoX) <= 0.02 * Math.max(1, factorTeoricoX);
    const factorOKY = Math.abs(ampY - factorTeoricoY) <= 0.02 * Math.max(1, factorTeoricoY);
    const factorOK = factorOKX && factorOKY;
    const num = (v, d = 6) => (v == null || Number.isNaN(Number(v))) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
    const descargarPy = () => {
      const head = `# Traza de comandos OpenSeesPy - generada por ETABS API + IA ${APP_VERSION}\n`
        + `# Verificacion cruzada con ETABS: modelo elastico 3D con diafragma rigido.\n`
        + `# Unidades: kN, m, ton (g = 9.81 m/s2).\nimport openseespy.opensees as ops\n\n`;
      const blob = new Blob([head + script.join('\n') + '\n'], { type: 'text/x-python;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'modelo_opensees.py';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showStatus('success', 'modelo_opensees.py descargado.');
    };
    const copiarScript = () => {
      navigator.clipboard?.writeText(script.join('\n')).then(
        () => showStatus('success', 'Comandos OpenSees copiados.'),
        () => showStatus('error', 'No se pudo copiar al portapapeles.'));
    };
    const secRow = (lbl, s) => s ? (
      <tr className="odd:bg-white/[0.02]">
        <td className="text-[9.5px] text-slate-300 px-2 py-1 font-bold">{lbl}</td>
        <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{num(s.A, 5)}</td>
        <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{num(s.E, 0)}</td>
        <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{num(s.Iy, 6)}</td>
        <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{num(s.Iz, 6)}</td>
        <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{num(s.J, 6)}</td>
      </tr>
    ) : null;
    return (
      <div className="flex-grow overflow-auto p-6">
        <div className="mx-auto" style={{ width: 1160 }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">🔧 Flujo OpenSees</h2>
              <p className="text-[9px] text-slate-500 mt-1">TODO lo ejecutado en OpenSees: datos colocados, funciones y argumentos. Modelo elástico 3D equivalente (verificación cruzada). Unidades kN, m, ton.</p>
            </div>
            <button onClick={verificarOpenSees} disabled={osLoading} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-slate-800 disabled:to-slate-800 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-violet-500/20 transition-all">{osLoading ? 'Corriendo…' : (osData ? '↻ Volver a correr' : '🔬 Correr OpenSees')}</button>
          </div>
          {meta && <div className="text-[9px] text-slate-500 mb-1">Datos del flujo: <b className="text-cyan-300">f&apos;c</b> {meta.fc} · <b className="text-cyan-300">Col</b> {meta.colSec} · <b className="text-cyan-300">Viga</b> {meta.vigaSec} cm · <b className="text-cyan-300">Losa</b> {meta.losa} ({meta.slabW} kgf/m²) · <b className="text-cyan-300">masa/piso</b> ≈ {Number(meta.masaPiso).toFixed(1)} ton</div>}
          {meta && <div className="text-[9px] text-slate-500 mb-1"><b className="text-fuchsia-300">Espectro (= el de ETABS):</b> {meta.espectro}</div>}
          {meta && <div className="text-[9px] text-slate-500 mb-3"><b className="text-cyan-300">Peso volumétrico:</b> concreto γ = {matParams.peso} kgf/m³ · acero Fy = {aceroParams.fy} kgf/cm² · <b className="text-cyan-300">Elementos dibujados (Modelador):</b> {dibujoElementos.filter(e => e.tipo === 'columna').length} columnas · {dibujoElementos.filter(e => e.tipo === 'viga').length} vigas · {dibujoElementos.filter(e => e.tipo === 'losa').length} losas · {dibujoElementos.filter(e => e.tipo === 'muro').length} muros (total {dibujoElementos.length})</div>}
          {osError && <div className="bg-red-950/60 border border-red-500/30 text-red-200 text-[10px] font-bold rounded-xl px-4 py-2.5 mb-3">{osError}</div>}
          {!osData ? (
            <div className={`${cardCls} text-[11px] text-slate-400`}>Aún no hay corrida. Pulsa <b className="text-fuchsia-300">🔬 Correr OpenSees</b> (usa la grilla, secciones y cargas de tu flujo). También puedes correrlo desde la pestaña 📊 Resultados.</div>
          ) : (
            <>
              {(() => {
                const os = osData;
                const osG = {
                  T1: Number(os.T1), mx: Number(os.modal?.masa_x_pct), my: Number(os.modal?.masa_y_pct),
                  vx: os.espectral ? Number(os.espectral.cortante_basal_x_kN) / 9.81 : null,
                  vy: os.espectral ? Number(os.espectral.cortante_basal_y_kN) / 9.81 : null,
                  drx: os.espectral ? Number(os.espectral.deriva_max_x) * ampX : null,
                  dry: os.espectral ? Number(os.espectral.deriva_max_y) * ampY : null,
                };
                if (!resData) {
                  return (
                    <div className={`${cardCls} mb-4`}>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <div className={tituloCls} style={{ marginBottom: 0 }}>Comparación dato a dato: ETABS vs OpenSees</div>
                          <p className="text-[9px] text-amber-300/80 mt-1">Aún no hay resultados de ETABS cargados. Corre el análisis en ETABS (paso 17 · Analizar) y trae los resultados para comparar.</p>
                        </div>
                        <button onClick={handleLeerResultados} disabled={resLoading} className="bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-cyan-300">{resLoading ? 'Leyendo…' : '📡 Leer resultados de ETABS'}</button>
                      </div>
                    </div>
                  );
                }
                const etTabla = resData.modal?.tabla || [];
                const last = etTabla.length ? etTabla[etTabla.length - 1] : null;
                const cb = resData.cortante_basal || {};
                const pick = (obj, subs) => { for (const k of Object.keys(obj || {})) if (subs.some(s => k.toUpperCase().includes(s))) return obj[k]; return null; };
                const csx = pick(cb, ['CSX', 'SX']), csy = pick(cb, ['CSY', 'SY']);
                const dfilas = resData.derivas?.filas || [];
                const drDir = l => { const v = dfilas.filter(f => (f.direccion || '').toUpperCase().includes(l)).map(f => Number(f.deriva) || 0); return v.length ? Math.max(...v) : null; };
                const etG = {
                  T1: resData.modal?.T1 != null ? Number(resData.modal.T1) : (etTabla[0] ? Number(etTabla[0].T) : null),
                  mx: last ? Number(last.sumUX) * 100 : null, my: last ? Number(last.sumUY) * 100 : null,
                  vx: csx ? Math.abs(Number(csx.FX)) / 1000 : null, vy: csy ? Math.abs(Number(csy.FY)) / 1000 : null,
                  drx: drDir('X'), dry: drDir('Y'),
                };
                const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v))) ? '—' : Number(v).toFixed(d);
                const dlt = (o, e) => (e == null || !e || o == null || Number.isNaN(Number(o))) ? '—' : `${(o - e) / e * 100 >= 0 ? '+' : ''}${((o - e) / e * 100).toFixed(1)}%`;
                const th = 'text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                const thL = 'text-left text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                const tdv = 'text-[9.5px] font-mono px-2 py-0.5 text-right';
                const rowG = (lbl, e, o, d = 2, nota) => (
                  <tr className="odd:bg-white/[0.02]"><td className="text-[9.5px] text-slate-300 px-2 py-1 font-bold">{lbl}{nota && <span className="text-slate-500 font-normal"> {nota}</span>}</td><td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{fmt(e, d)}</td><td className="text-[9.5px] text-fuchsia-200 font-mono px-2 py-1 text-right">{fmt(o, d)}</td><td className="text-[9.5px] text-slate-400 font-mono px-2 py-1 text-right">{dlt(o, e)}</td></tr>
                );
                const etP = etTabla.map(m => Number(m.T)).sort((a, b) => b - a);
                const osP = (os.modal?.tabla || []).map(m => Number(m.T)).sort((a, b) => b - a);
                const nP = Math.min(etP.length, osP.length);
                const osPerfil = [...(os.espectral?.perfil || [])].sort((a, b) => Number(b.z) - Number(a.z));
                const etDespX = [...(pick(resData.desplazamientos?.por_caso, ['CSX', 'X']) || [])].sort((a, b) => Number(b.elev) - Number(a.elev));
                const etDespY = [...(pick(resData.desplazamientos?.por_caso, ['CSY', 'Y']) || [])].sort((a, b) => Number(b.elev) - Number(a.elev));
                const etDerX = [...(pick(resData.derivas?.perfil, ['DERVX', 'CSX', 'X']) || [])].sort((a, b) => Number(b.elev) - Number(a.elev));
                const etDerY = [...(pick(resData.derivas?.perfil, ['DERVY', 'CSY', 'Y']) || [])].sort((a, b) => Number(b.elev) - Number(a.elev));
                return (
                  <div className={`${cardCls} mb-4 ring-1 ring-fuchsia-500/20`}>
                    <div className={tituloCls}>⚖️ Comparación dato a dato: ETABS vs OpenSees</div>
                    <div className={`text-[9px] font-bold mb-3 px-2.5 py-1.5 rounded-lg border ${factorOK ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                      {factorOK ? '✓' : '⚠'} Amplificación de deriva (E.030): estructura <b>{esIrregular ? 'IRREGULAR → 0.85·R' : 'REGULAR → 0.75·R'}</b>, con <b>R = R₀·Ia·Ip</b> por dirección (X: {RxDer.toFixed(2)}, Y: {RyDer.toFixed(2)}) → esperado <b>DERVX = {factorTeoricoX.toFixed(3)}</b>, <b>DERVY = {factorTeoricoY.toFixed(3)}</b>; en ETABS <b>DERVX = {ampX.toFixed(3)}</b>, <b>DERVY = {ampY.toFixed(3)}</b>{factorOK ? ' ✓ coinciden.' : ` — REVISA: ajusta los SF en el paso Combinaciones (X=${factorTeoricoX.toFixed(3)}, Y=${factorTeoricoY.toFixed(3)}).`} OpenSees usa los mismos factores.
                    </div>
                    <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Cargas, masa y peso totales (tonf · ton)</div>
                    <div className="overflow-auto rounded-lg border border-white/5 mb-4">
                      <table className="w-full">
                        <thead className="bg-[#0b0e14]"><tr><th className={thL}>Concepto</th><th className={`${th} text-cyan-400`}>ETABS</th><th className={`${th} text-fuchsia-400`}>OpenSees</th><th className={th}>Δ</th></tr></thead>
                        <tbody>
                          {(() => {
                            const fCMm = Number(espectroParams.masaCM) || 1.0, fCVm = Number(espectroParams.masaCV) || 0.5;
                            const casoTot = v => Math.max(Math.abs(Number(v.FX) || 0), Math.abs(Number(v.FY) || 0), Math.abs(Number(v.FZ) || 0)) / 1000;
                            const etCM = cb.CM ? Math.abs(Number(cb.CM.FZ)) / 1000 : null;
                            const etCV = cb.CV ? Math.abs(Number(cb.CV.FZ)) / 1000 : null;
                            const etPesoSis = (etCM != null || etCV != null) ? (fCMm * (etCM || 0) + fCVm * (etCV || 0)) : null;
                            const rows = [];
                            Object.entries(cb).forEach(([caso, v]) => {
                              const cu = caso.toUpperCase(); let os = null, lbl = caso; const et = casoTot(v);
                              if (cu.includes('SX')) { os = osG.vx; lbl = `${caso} · cortante basal X`; }
                              else if (cu.includes('SY')) { os = osG.vy; lbl = `${caso} · cortante basal Y`; }
                              else if (cu === 'CM' || cu.includes('DEAD') || cu.includes('MUERT')) { os = meta?.pesoMuertoTon; lbl = `${caso} · peso muerto`; }
                              else if (cu === 'CV' || cu.includes('LIVE') || cu.includes('VIVA')) { os = meta?.pesoVivoTon; lbl = `${caso} · carga viva`; }
                              else { lbl = `${caso} · reacción FZ`; }
                              rows.push({ lbl, et, os });
                            });
                            rows.push({ lbl: `Peso sísmico (${fCMm}·CM+${fCVm}·CV)`, et: etPesoSis, os: meta?.pesoSismicoTon, b: true });
                            rows.push({ lbl: 'Masa sísmica (ton)', et: etPesoSis, os: meta?.masaTot, b: true });
                            return rows.map((r, i) => (
                              <tr key={i} className={`odd:bg-white/[0.02] ${r.b ? 'font-bold' : ''}`}>
                                <td className="text-[9.5px] text-slate-300 px-2 py-1">{r.lbl}</td>
                                <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{fmt(r.et, 1)}</td>
                                <td className="text-[9.5px] text-fuchsia-200 font-mono px-2 py-1 text-right">{fmt(r.os, 1)}</td>
                                <td className="text-[9.5px] text-slate-400 font-mono px-2 py-1 text-right">{dlt(r.os, r.et)}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[8.5px] text-slate-600 -mt-2 mb-3">ETABS: reacciones en la base por caso (FZ para CM/CV/CE = peso; FX/FY para CSX/CSY = cortante), de kgf a tonf. OpenSees: peso muerto/vivo del modelo (peso propio + cargas) y cortante espectral. Masa sísmica (ton) = peso sísmico (tonf).</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Respuesta dinámica</div>
                        <table className="w-full">
                          <thead><tr><th className={thL}>Parámetro</th><th className={`${th} text-cyan-400`}>ETABS</th><th className={`${th} text-fuchsia-400`}>OpenSees</th><th className={th}>Δ</th></tr></thead>
                          <tbody>
                            {rowG('T₁ (s)', etG.T1, osG.T1, 4)}
                            {rowG('Masa partic. X (%)', etG.mx, osG.mx, 1)}
                            {rowG('Masa partic. Y (%)', etG.my, osG.my, 1)}
                            {rowG('Deriva máx X', etG.drx, osG.drx, 5, `(OS ×${ampX.toFixed(2)})`)}
                            {rowG('Deriva máx Y', etG.dry, osG.dry, 5, `(OS ×${ampY.toFixed(2)})`)}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Periodos por modo (ordenados desc.)</div>
                        <div className="max-h-[230px] overflow-y-auto rounded-lg border border-white/5">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Modo</th><th className={`${th} text-cyan-400`}>T ETABS</th><th className={`${th} text-fuchsia-400`}>T OpenSees</th><th className={th}>Δ</th></tr></thead>
                            <tbody>
                              {Array.from({ length: nP }, (_, i) => (
                                <tr key={i} className="odd:bg-white/[0.02]"><td className={`${tdv} text-left text-slate-300 font-bold`}>{i + 1}</td><td className={`${tdv} text-cyan-200`}>{fmt(etP[i], 4)}</td><td className={`${tdv} text-fuchsia-200`}>{fmt(osP[i], 4)}</td><td className={`${tdv} text-slate-400`}>{dlt(osP[i], etP[i])}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                    <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mt-3 mb-1">Por piso · desplazamientos (mm) y derivas inelásticas — tope → base (como ETABS)</div>
                    <div className="max-h-[300px] overflow-auto rounded-lg border border-white/5">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-[#0b0e14]">
                          <tr>
                            <th className={thL} rowSpan={2}>Piso</th>
                            <th className={`${th} text-center`} colSpan={3}>Ux (mm)</th>
                            <th className={`${th} text-center`} colSpan={3}>Uy (mm)</th>
                            <th className={`${th} text-center`} colSpan={3}>Deriva X</th>
                            <th className={`${th} text-center`} colSpan={3}>Deriva Y</th>
                          </tr>
                          <tr>
                            {['ux', 'uy', 'dx', 'dy'].map(g => (
                              <React.Fragment key={g}><th className={`${th} text-cyan-400`}>ETABS</th><th className={`${th} text-fuchsia-400`}>OS</th><th className={th}>Δ</th></React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {osPerfil.map((p, i) => {
                            const eUx = etDespX[i] ? Number(etDespX[i].ux) : null;
                            const eUy = etDespY[i] ? Number(etDespY[i].uy) : null;
                            const oUx = Number(p.ux_m) * 1000, oUy = Number(p.uy_m) * 1000;
                            const eDx = etDerX[i] ? Number(etDerX[i].dx) : null;
                            const eDy = etDerY[i] ? Number(etDerY[i].dy) : null;
                            const oDx = Number(p.deriva_x) * ampX, oDy = Number(p.deriva_y) * ampY;
                            const cell = (e, o, d) => (<><td className={`${tdv} text-cyan-200`}>{fmt(e, d)}</td><td className={`${tdv} text-fuchsia-200`}>{fmt(o, d)}</td><td className={`${tdv} text-slate-400`}>{dlt(o, e)}</td></>);
                            return (
                              <tr key={i} className="odd:bg-white/[0.02]">
                                <td className={`${tdv} text-left text-slate-300 font-bold`}>{p.piso}</td>
                                {cell(eUx, oUx, 2)}{cell(eUy, oUy, 2)}{cell(eDx, oDx, 5)}{cell(eDy, oDy, 5)}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[8.5px] text-slate-600 mt-1">ETABS: desplazamientos de CSX/CSY (mm) y derivas de DERVX/DERVY (ya inelásticas). La deriva elástica de OpenSees se amplifica ×{ampX.toFixed(3)} en X y ×{ampY.toFixed(3)} en Y ({esIrregular ? '0.85' : '0.75'}·R, R=R₀·Ia·Ip por dirección) para comparar. Pisos alineados por elevación.</div>
                    <p className="text-[8.5px] text-slate-600 mt-2">El periodo (T₁ y por modo), la masa participativa y el cortante basal son contrastes DIRECTOS; pequeñas Δ vienen de masas estimadas por peso/m² y secciones uniformes. Si una Δ es grande, revisa que las cargas (CM/CV) y secciones del flujo coincidan con tu modelo de ETABS.</p>
                  </div>
                );
              })()}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className={cardCls}>
                  <div className={tituloCls}>Resumen del modelo</div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {[['Nudos', dz.n_nodos], ['Columnas', dz.n_columnas], ['Vigas', dz.n_vigas], ['Apoyos', dz.n_apoyos], ['Pisos', osData.n_pisos], ['Modos', dz.nmodes], ['γ concreto', `${matParams.peso} kgf/m³`], ['Dibujados', dibujoElementos.length], ['Peso muerto', `${num(meta?.pesoMuertoTon, 0)} tonf`], ['Peso vivo', `${num(meta?.pesoVivoTon, 0)} tonf`], ['Peso sísmico', `${num(meta?.pesoSismicoTon, 0)} tonf`], ['Masa total', `${num(osData.masa_total_ton, 0)} ton`], ['Comandos', osData.n_comandos]].map(([k, v]) => (
                      <div key={k} className="flex justify-between bg-black/30 rounded px-2 py-1"><span className="text-slate-500">{k}</span><b className="text-cyan-200">{v}</b></div>
                    ))}
                  </div>
                  <div className="text-[8.5px] text-slate-600 mt-2">{dz.unidades}</div>
                </div>
                <div className={`${cardCls} col-span-2`}>
                  <div className={tituloCls}>Secciones colocadas (elasticBeamColumn)</div>
                  <table className="w-full">
                    <thead><tr><th className="text-left text-[8px] text-slate-500 font-black uppercase px-2 py-1">Elem</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">A (m²)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">E (kN/m²)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">Iy (m⁴)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">Iz (m⁴)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">J (m⁴)</th></tr></thead>
                    <tbody>{secRow('Columna', dz.seccion_columna)}{secRow('Viga', dz.seccion_viga)}</tbody>
                  </table>
                  <div className={tituloCls} style={{ marginTop: '10px' }}>Masas por piso (diafragma rígido)</div>
                  <div className="max-h-32 overflow-y-auto">
                    <table className="w-full">
                      <thead><tr><th className="text-left text-[8px] text-slate-500 font-black uppercase px-2 py-1">Piso</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">z (m)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">h (m)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">masa (ton)</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">Izz</th><th className="text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1">nudo maestro</th></tr></thead>
                      <tbody>{(dz.pisos || []).map((p, i) => (<tr key={i} className="odd:bg-white/[0.02]"><td className="text-[9.5px] text-slate-300 px-2 py-0.5 font-bold">{p.nombre}</td><td className="text-[9.5px] text-slate-300 font-mono px-2 py-0.5 text-right">{p.z}</td><td className="text-[9.5px] text-slate-300 font-mono px-2 py-0.5 text-right">{p.h}</td><td className="text-[9.5px] text-cyan-200 font-mono px-2 py-0.5 text-right">{p.masa_ton}</td><td className="text-[9.5px] text-slate-400 font-mono px-2 py-0.5 text-right">{num(p.inercia_izz, 1)}</td><td className="text-[9.5px] text-slate-400 font-mono px-2 py-0.5 text-right">{p.maestro}</td></tr>))}</tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className={`${cardCls} mb-4`}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className={tituloCls} style={{ marginBottom: 0 }}>📡 Modelo REAL de ETABS (extraído) vs OpenSees</div>
                  <button onClick={extraerModeloEtabs} disabled={etabsModeloLoading} className="bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-cyan-300">{etabsModeloLoading ? 'Extrayendo…' : '📡 Extraer de ETABS'}</button>
                </div>
                {etabsModeloError && <div className="bg-red-950/60 border border-red-500/30 text-red-200 text-[10px] font-bold rounded-xl px-4 py-2.5 mb-2">{etabsModeloError}</div>}
                {!etabsModelo ? (
                  <div className="text-[10px] text-slate-500">Pulsa <b className="text-cyan-300">📡 Extraer de ETABS</b> para leer del modelo abierto los conteos, secciones (A/E/I), <b>las losas con su tipo de shell</b> (membrana/shell-thin) y las masas por piso, y compararlos con OpenSees. (Necesita el modelo abierto/analizado.)</div>
                ) : (() => {
                  const em = etabsModelo;
                  const thL = 'text-left text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                  const th = 'text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                  const tdv = 'text-[9.5px] font-mono px-2 py-0.5 text-right';
                  const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v))) ? '—' : Number(v).toFixed(d);
                  const dlt = (e, o) => (e == null || !e || o == null || Number.isNaN(Number(o))) ? '—' : `${(o - e) / e * 100 >= 0 ? '+' : ''}${((o - e) / e * 100).toFixed(1)}%`;
                  const cmpRow = (lbl, e, o) => (<tr className="odd:bg-white/[0.02]"><td className="text-[9.5px] text-slate-300 px-2 py-1 font-bold">{lbl}</td><td className={`${tdv} text-cyan-200`}>{e ?? '—'}</td><td className={`${tdv} text-fuchsia-200`}>{o ?? '—'}</td><td className={`${tdv} text-slate-400`}>{dlt(Number(e), Number(o))}</td></tr>);
                  const masT = (em.masas_piso || []).reduce((s, p) => s + (Number(p.masa_x) || 0), 0);
                  const osMasT = Number(osData.masa_total_ton) || 0;
                  return (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Conteo de elementos</div>
                        <table className="w-full">
                          <thead><tr><th className={thL}>Tipo</th><th className={`${th} text-cyan-400`}>ETABS</th><th className={`${th} text-fuchsia-400`}>OpenSees</th><th className={th}>Δ</th></tr></thead>
                          <tbody>
                            {cmpRow('Columnas', em.conteo?.columna, dz.n_columnas)}
                            {cmpRow('Vigas', em.conteo?.viga, dz.n_vigas)}
                            {cmpRow('Losas', em.conteo?.losa, dz.n_losas)}
                            {cmpRow('Muros', em.conteo?.muro, '—')}
                            {cmpRow('Nudos', em.conteo?.nudos, dz.n_nodos)}
                          </tbody>
                        </table>
                        <div className="text-[8px] text-slate-500 mt-1 leading-snug">{dz.n_losas ? (
                          <span>OpenSees modela cada paño como cáscara <b className="text-emerald-300">ShellMITC4</b> ({dz.n_losas} losas); ojo: trae rigidez de placa, rigidiza el modelo (≈ shell-thin).</span>
                        ) : (
                          <span>OpenSees usa <b className="text-amber-300">membrana = diafragma rígido</b> (sin elemento de área en 3D; el modelo fiel de membrana). Por eso el conteo de losas es 0. Cambia "Modelo de losa" a ShellMITC4 si quieres verlas como elemento.</span>
                        )}</div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mt-3 mb-1">Losas · tipo de elemento (shell)</div>
                        <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Losa</th><th className={thL}>Tipo</th><th className={th}>Espesor (cm)</th><th className={thL} style={{ textAlign: 'left' }}>Shell</th></tr></thead>
                            <tbody>
                              {(em.losas || []).length ? em.losas.map((l, i) => (
                                <tr key={i} className="odd:bg-white/[0.02]">
                                  <td className="text-[9.5px] text-slate-300 px-2 py-0.5 font-bold">{l.nombre}</td>
                                  <td className="text-[9.5px] text-slate-400 px-2 py-0.5">{l.tipo}</td>
                                  <td className={`${tdv} text-slate-300`}>{l.espesor ?? '—'}</td>
                                  <td className={`px-2 py-0.5 text-[9.5px] font-bold ${/membrana/i.test(l.shell || '') ? 'text-amber-300' : 'text-emerald-300'}`}>{l.shell || '—'}</td>
                                </tr>
                              )) : <tr><td colSpan={4} className="text-[9.5px] text-slate-500 px-2 py-1">Sin losas en el modelo.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Secciones de ETABS (A m² · E kN/m² · Iy/Iz m⁴)</div>
                        <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Sección</th><th className={th}>b×h</th><th className={th}>A</th><th className={th}>E</th><th className={th}>Iy</th><th className={th}>Iz</th></tr></thead>
                            <tbody>
                              {[...(em.columnas_sec || []), ...(em.vigas_sec || [])].map((s, i) => (
                                <tr key={i} className="odd:bg-white/[0.02]">
                                  <td className="text-[9.5px] text-slate-300 px-2 py-0.5 font-bold">{s.nombre}</td>
                                  <td className={`${tdv} text-slate-400`}>{s.base}×{s.peralte}</td>
                                  <td className={`${tdv} text-cyan-200`}>{fmt(s.A, 4)}</td>
                                  <td className={`${tdv} text-cyan-200`}>{s.E ? Number(s.E).toLocaleString('en-US') : '—'}</td>
                                  <td className={`${tdv} text-cyan-200`}>{fmt(s.Iy, 6)}</td>
                                  <td className={`${tdv} text-cyan-200`}>{fmt(s.Iz, 6)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[8px] text-slate-600 mt-1">OpenSees usa una columna {dz.seccion_columna ? `(A=${fmt(dz.seccion_columna.A, 4)}, Iy=${fmt(dz.seccion_columna.Iy, 6)})` : ''} y una viga representativas.</div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mt-3 mb-1">Masa por piso (ton) — ETABS vs OpenSees</div>
                        <div className="max-h-36 overflow-y-auto rounded-lg border border-white/5">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Piso (ETABS)</th><th className={`${th} text-cyan-400`}>ETABS</th><th className={`${th} text-fuchsia-400`}>OpenSees</th><th className={th}>Δ</th></tr></thead>
                            <tbody>
                              {(em.masas_piso || []).length ? em.masas_piso.map((p, i) => {
                                const os = (dz.pisos || [])[(dz.pisos || []).length - 1 - i];
                                return (<tr key={i} className="odd:bg-white/[0.02]">
                                  <td className="text-[9.5px] text-slate-300 px-2 py-0.5 font-bold">{p.piso}</td>
                                  <td className={`${tdv} text-cyan-200`}>{fmt(p.masa_x, 2)}</td>
                                  <td className={`${tdv} text-fuchsia-200`}>{os ? fmt(os.masa_ton, 2) : '—'}</td>
                                  <td className={`${tdv} text-slate-400`}>{os ? dlt(Number(p.masa_x), Number(os.masa_ton)) : '—'}</td>
                                </tr>);
                              }) : <tr><td colSpan={4} className="text-[9.5px] text-amber-300/80 px-2 py-1">Sin masas (corre el análisis en ETABS; se lee de "Mass Summary by Story").</td></tr>}
                              <tr className="font-bold border-t border-white/10"><td className="text-[9.5px] text-slate-200 px-2 py-1">TOTAL</td><td className={`${tdv} text-cyan-200`}>{fmt(masT, 1)}</td><td className={`${tdv} text-fuchsia-200`}>{fmt(osMasT, 1)}</td><td className={`${tdv} text-slate-400`}>{dlt(masT, osMasT)}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const modos = osData.modal?.tabla || [];
                let accX = 0, accY = 0;
                const modosRows = modos.map(m => { accX += Number(m.masa_x_pct) || 0; accY += Number(m.masa_y_pct) || 0; return { ...m, accX, accY }; });
                const perfil = [...(osData.espectral?.perfil || [])].reverse();   // tope -> base (como ETABS)
                const vx = osData.espectral ? Number(osData.espectral.cortante_basal_x_kN) / 9.81 : null;
                const vy = osData.espectral ? Number(osData.espectral.cortante_basal_y_kN) / 9.81 : null;
                const th = 'text-right text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                const thL = 'text-left text-[8px] text-slate-500 font-black uppercase px-2 py-1';
                const td = 'text-[9.5px] font-mono px-2 py-0.5 text-right';
                return (
                  <div className={`${cardCls} mb-4`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className={tituloCls} style={{ marginBottom: 0 }}>Resultados parciales de OpenSees (para comparar con ETABS)</div>
                      <div className="text-[8.5px] text-slate-500">compara con la pestaña <b className="text-cyan-300">📊 Resultados</b> (tabla modal y derivas/desplazamientos de ETABS)</div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Modal · participación de masa (por modo)</div>
                        <div className="max-h-60 overflow-y-auto rounded-lg border border-white/5">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Modo</th><th className={th}>T (s)</th><th className={th}>f (Hz)</th><th className={th}>Masa X</th><th className={th}>Masa Y</th><th className={th}>Σ X</th><th className={th}>Σ Y</th></tr></thead>
                            <tbody>
                              {modosRows.map((m, i) => (
                                <tr key={i} className="odd:bg-white/[0.02]">
                                  <td className={`${td} text-left text-slate-300 font-bold`}>{m.modo}</td>
                                  <td className={`${td} text-cyan-200`}>{Number(m.T).toFixed(4)}</td>
                                  <td className={`${td} text-slate-400`}>{m.T > 0 ? (1 / m.T).toFixed(3) : '—'}</td>
                                  <td className={`${td} text-sky-200`}>{Number(m.masa_x_pct).toFixed(1)}%</td>
                                  <td className={`${td} text-rose-200`}>{Number(m.masa_y_pct).toFixed(1)}%</td>
                                  <td className={`${td} text-sky-300/70`}>{m.accX.toFixed(1)}%</td>
                                  <td className={`${td} text-rose-300/70`}>{m.accY.toFixed(1)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[8.5px] text-slate-600 mt-1">T₁ = <b className="text-cyan-300">{Number(osData.T1).toFixed(4)} s</b>. Σ debe llegar a ~100 % (chequeo E.030: ≥90 %).</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Por piso · desplazamientos y derivas (espectro E.030)</div>
                        {perfil.length ? (
                          <div className="max-h-60 overflow-y-auto rounded-lg border border-white/5">
                            <table className="w-full">
                              <thead className="sticky top-0 bg-[#0b0e14]"><tr><th className={thL}>Piso</th><th className={th}>Ux (mm)</th><th className={th}>Uy (mm)</th><th className={th}>Deriva X</th><th className={th}>Deriva Y</th><th className={th}>Der.X·{ampX.toFixed(2)}</th><th className={th}>Der.Y·{ampY.toFixed(2)}</th></tr></thead>
                              <tbody>
                                {perfil.map((p, i) => (
                                  <tr key={i} className="odd:bg-white/[0.02]">
                                    <td className={`${td} text-left text-slate-300 font-bold`}>{p.piso}</td>
                                    <td className={`${td} text-sky-200`}>{(Number(p.ux_m) * 1000).toFixed(2)}</td>
                                    <td className={`${td} text-rose-200`}>{(Number(p.uy_m) * 1000).toFixed(2)}</td>
                                    <td className={`${td} text-sky-300/80`}>{Number(p.deriva_x).toFixed(5)}</td>
                                    <td className={`${td} text-rose-300/80`}>{Number(p.deriva_y).toFixed(5)}</td>
                                    <td className={`${td} text-sky-200`}>{(Number(p.deriva_x) * ampX).toFixed(5)}</td>
                                    <td className={`${td} text-rose-200`}>{(Number(p.deriva_y) * ampY).toFixed(5)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : <div className="text-[10px] text-amber-300/80">Sin perfil (no se definió el espectro).</div>}
                        <div className="text-[8.5px] text-slate-600 mt-1">Cortante basal: <b className="text-sky-300">X = {vx != null ? vx.toFixed(1) : '—'} tonf</b> · <b className="text-rose-300">Y = {vy != null ? vy.toFixed(1) : '—'} tonf</b>. Ux/Uy y derivas son ELÁSTICAS bajo el espectro reducido; las columnas Der·{ampX.toFixed(2)}/{ampY.toFixed(2)} son la deriva inelástica ({esIrregular ? '0.85' : '0.75'}·R, R=R₀·Ia·Ip por dirección) para comparar con DERVX/Y de ETABS.</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const GLOSARIO = [
                  { call: 'ops.wipe(', sig: 'ops.wipe()', que: 'Borra cualquier modelo previo en memoria.', args: [] },
                  { call: 'ops.model(', sig: "ops.model('basic', '-ndm', 3, '-ndf', 6)", que: 'Crea el modelo estructural.', args: [["'basic'", 'constructor básico de modelo'], ['-ndm 3', '3 dimensiones (espacio 3D)'], ['-ndf 6', '6 grados de libertad por nudo: UX, UY, UZ, RX, RY, RZ']] },
                  { call: 'ops.node(', sig: 'ops.node(tag, x, y, z)', que: 'Define un nudo.', args: [['tag', 'número identificador del nudo'], ['x, y, z', 'coordenadas del nudo (m)']] },
                  { call: 'ops.fix(', sig: 'ops.fix(tag, ux, uy, uz, rx, ry, rz)', que: 'Restringe los GDL de un nudo (apoyo / condición de borde).', args: [['tag', 'nudo a restringir'], ['ux … rz', '1 = fijo, 0 = libre, en orden UX, UY, UZ, RX, RY, RZ']] },
                  { call: 'ops.geomTransf(', sig: "ops.geomTransf('Linear', tag, vx, vy, vz)", que: 'Transformación geométrica: relaciona los ejes locales del elemento con los globales.', args: [["'Linear'", 'transformación lineal (sin efectos P-Δ)'], ['tag', 'número de la transformación (1 = columnas, 2 = vigas)'], ['vx, vy, vz', 'vector que orienta el plano local x-z del elemento']] },
                  { call: "ops.element('elasticBeamColumn'", sig: "ops.element('elasticBeamColumn', tag, ni, nj, A, E, G, J, Iy, Iz, transf)", que: 'Elemento viga-columna ELÁSTICO 3D entre dos nudos.', args: [['tag', 'número del elemento'], ['ni, nj', 'nudos inicial y final'], ['A', 'área de la sección (m²)'], ['E', 'módulo de elasticidad (kN/m²) = 15000·√f′c'], ['G', 'módulo de corte (kN/m²) = E / 2(1+ν)'], ['J', 'constante torsional (m⁴)'], ['Iy, Iz', 'momentos de inercia locales (m⁴)'], ['transf', 'número de la transformación geométrica']] },
                  { call: 'ops.mass(', sig: 'ops.mass(tag, mx, my, mz, rx, ry, rz)', que: 'Asigna masa concentrada a un nudo, por GDL (aquí en el nudo maestro del piso).', args: [['tag', 'nudo maestro del diafragma'], ['mx, my', 'masa traslacional en X, Y (ton)'], ['mz, rx, ry', 'masa/inercia en Z y rotaciones X, Y (0 en este modelo)'], ['rz', 'inercia rotacional del piso respecto a Z (ton·m²)']] },
                  { call: 'ops.rigidDiaphragm(', sig: 'ops.rigidDiaphragm(perpDir, maestro, *esclavos)', que: 'DIAFRAGMA RÍGIDO: liga los nudos del piso a un nudo maestro (losa rígida en su plano), como ETABS por defecto.', args: [['perpDir', '3 = el plano del diafragma es perpendicular al eje Z (piso horizontal)'], ['maestro', 'nudo maestro (centro de masa del piso)'], ['*esclavos', 'nudos del piso ligados al maestro']] },
                  { call: 'ops.eigen(', sig: 'ops.eigen(nModos)', que: 'ANÁLISIS MODAL: calcula los valores propios (ω²) y las formas de modo.', args: [['nModos', 'número de modos; devuelve ω² (rad²/s²). Periodo T = 2π/ω']] },
                  { call: 'ops.nodeEigenvector(', sig: 'ops.nodeEigenvector(tag, modo, gdl)', que: 'Componente de la forma de modo (post-proceso para la masa participativa).', args: [['tag', 'nudo (maestro)'], ['modo', 'número de modo'], ['gdl', 'grado de libertad (1 = UX, 2 = UY, 6 = RZ)']] },
                ].filter(g => script.some(l => l.startsWith(g.call)));
                return (
                  <details className="mb-4 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
                    <summary className="text-[10px] font-black text-cyan-300 uppercase tracking-widest cursor-pointer">📖 Glosario: qué hace cada comando y qué significa cada argumento ({GLOSARIO.length})</summary>
                    <div className="mt-3 space-y-3">
                      {GLOSARIO.map((g, i) => (
                        <div key={i} className="border-l-2 border-cyan-500/30 pl-3">
                          <div className="font-mono text-[10px] text-cyan-200">{g.sig}</div>
                          <div className="text-[9.5px] text-slate-300 mt-0.5">{g.que}</div>
                          {g.args.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {g.args.map(([a, d], j) => (
                                <li key={j} className="text-[9px] text-slate-400 flex gap-2"><span className="font-mono text-amber-300/90 shrink-0 min-w-[64px]">{a}</span><span>{d}</span></li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}

              <div className={cardCls}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className={tituloCls} style={{ marginBottom: 0 }}>Flujo de comandos OpenSees · {osData.n_comandos} llamadas con sus argumentos</div>
                  <div className="flex gap-1.5">
                    <button onClick={copiarScript} className="bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase text-cyan-200">📋 Copiar</button>
                    <button onClick={descargarPy} className="bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase text-cyan-200">⬇️ .py</button>
                  </div>
                </div>
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 max-h-[520px] overflow-auto font-mono text-[10px] leading-relaxed">
                  {script.map((line, i) => line.startsWith('#') ? (
                    <div key={i} className="text-cyan-300 font-bold mt-2 mb-0.5">{line.replace(/=+/g, '').trim()}</div>
                  ) : (
                    <div key={i} className="text-slate-300 whitespace-pre-wrap break-all"><span className="text-slate-600 select-none mr-2">{String(i + 1).padStart(3, '0')}</span>{line}</div>
                  ))}
                </div>
                <p className="text-[8.5px] text-slate-600 mt-2">Traza FIEL: cada línea es una llamada real a OpenSeesPy con sus argumentos exactos. El .py reproduce el modelo + el análisis modal (las lecturas <span className="font-mono">nodeEigenvector</span> son de post-proceso de la masa participativa).</p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // MODELADOR: lee la geometria REAL del modelo abierto (frames/areas + grilla +
  // pisos) y reemplaza el dibujo local, para que el Modelador refleje lo que hay en
  // ETABS. Fija la fuente de grilla en "modelo real" para que todo alinee.
  const handleLeerModeloGeo = async () => {
    if (dibujoElementos.length && !window.confirm(
      `Esto reemplazara el dibujo actual (${dibujoElementos.length} elementos) con la geometria leida de ETABS. ¿Continuar?`)) return;
    setModGeoLoading(true);
    try {
      const response = await fetch(`${config.pythonUrl}/etabs/modelo-geometria?pid=${instanciaPid || 0}`);
      const data = await response.json();
      if (data.success) {
        setModeloGeo(data);
        setFuenteGrilla('real');
        let k = Date.now();
        setDibujoElementos((data.elementos || []).map(e => ({ id: ++k + Math.random(), ...e })));
        const c = data.conteo || {};
        showStatus('success', `Leido de ETABS: ${c.columna || 0} columnas, ${c.viga || 0} vigas, ${c.losa || 0} losas, ${c.muro || 0} muros.`);
      } else {
        showStatus('error', data.error || 'No se pudo leer la geometria del modelo (¿analizaste/abriste un modelo?).');
      }
    } catch {
      showStatus('error', 'No se pudo conectar al servidor Python (revisa el banner / reinicia INICIAR TODO.bat).');
    }
    setModGeoLoading(false);
  };

  // MODELADOR: LLEVAR a ETABS. Compara el dibujo actual con lo leido (modeloGeo) por
  // GEOMETRIA: lo que esta en el dibujo y no en ETABS se AGREGA; lo que estaba en
  // ETABS y se quito del dibujo se BORRA (por su nombre). Si el modelo esta BLOQUEADO
  // (candado, tras el analisis) avisa y, si confirmas, lo DESBLOQUEA. EJECUTA DIRECTO
  // en ETABS (no va a Codigo + Terminal). Tras sincronizar conviene "Leer de ETABS"
  // de nuevo para refrescar los nombres de los elementos agregados.
  const llevarAEtabs = async () => {
    const snap = (modeloGeo && modeloGeo.elementos) || [];
    if (!dibujoElementos.length && !snap.length) return showStatus('error', 'No hay nada que sincronizar.');
    const clavesActual = new Set(dibujoElementos.map(claveGeo));
    const clavesSnap = new Set(snap.map(claveGeo));
    const aBorrar = snap.filter(e => e.name && !clavesActual.has(claveGeo(e))).map(e => ({ tipo: e.tipo, name: e.name }));
    const aAgregar = dibujoElementos.filter(e => !clavesSnap.has(claveGeo(e)));
    if (!aAgregar.length && !aBorrar.length) return showStatus('error', 'No hay cambios respecto a lo leido de ETABS (nada que crear ni borrar).');
    // ¿El modelo esta bloqueado (candado tras el analisis)?
    let bloqueado = false;
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/estado-modelo?pid=${instanciaPid || 0}`);
      const d = await r.json();
      if (d.success) bloqueado = !!d.bloqueado;
    } catch { /* si no se puede leer, seguimos; el modelo se desbloquea por las dudas */ }
    let msg = `Se aplicara en ETABS: ${aAgregar.length} elemento(s) nuevo(s) y ${aBorrar.length} borrado(s).`;
    if (bloqueado) msg += `\n\n⚠️ EL MODELO ESTA BLOQUEADO (candado): se corrio el analisis. Para modificarlo hay que DESBLOQUEARLO, lo que DESCARTA los resultados del analisis.`;
    msg += `\n\n¿Aplicar en ETABS ahora?`;
    if (!window.confirm(msg)) return;
    const body = buildDibujoManualBody({
      columnas: aAgregar.filter(e => e.tipo === 'columna'),
      vigas: aAgregar.filter(e => e.tipo === 'viga'),
      losas: aAgregar.filter(e => e.tipo === 'losa'),
      muros: aAgregar.filter(e => e.tipo === 'muro'),
      borrar: aBorrar,
      desbloquear: bloqueado,
    });
    const script = assembleScript({ modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 8, modelPath: '', body });
    setPythonCode(script);
    setLastCodeFromAi(false);
    executeCode(script, 'modelador');   // ejecuta DIRECTO en ETABS
  };

  // ----- Acero, muros y dibujo separado viga/columna (v3.2.0) -----
  const buildCurrentAceroScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSteelMaterialBody({ nombre: (aceroParams.nombre || 'ACERO_FY4200').trim(), fy: Number(aceroParams.fy) || 4200, fu: Number(aceroParams.fu) || 6300 })
  });
  const handleCreateAcero = () => { const s = buildCurrentAceroScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'acero'); };
  const handleInsertAcero = () => { setPythonCode(buildCurrentAceroScript()); setLastCodeFromAi(false); showStatus('success', 'Script de acero insertado.'); };

  const buildCurrentDibVigaScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildDrawFramesBody({ seccionColumna: (drawParams.seccionColumna || 'C40X40').trim(), seccionViga: (drawParams.seccionViga || 'V30X60').trim(), vigasX: Boolean(drawParams.vigasX), vigasY: Boolean(drawParams.vigasY), dibujarColumnas: false, dibujarVigas: true })
  });
  const handleCreateDibViga = () => { const s = buildCurrentDibVigaScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'dibviga'); };
  const handleInsertDibViga = () => { setPythonCode(buildCurrentDibVigaScript()); setLastCodeFromAi(false); showStatus('success', 'Script de dibujo de vigas insertado.'); };

  const buildCurrentDibColScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildDrawFramesBody({ seccionColumna: (drawParams.seccionColumna || 'C40X40').trim(), seccionViga: (drawParams.seccionViga || 'V30X60').trim(), vigasX: false, vigasY: false, dibujarColumnas: true, dibujarVigas: false })
  });
  const handleCreateDibCol = () => { const s = buildCurrentDibColScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'dibcolumna'); };
  const handleInsertDibCol = () => { setPythonCode(buildCurrentDibColScript()); setLastCodeFromAi(false); showStatus('success', 'Script de dibujo de columnas insertado.'); };

  // Dibujar/cargar losa por tipo: reusa los builders genericos con la losa elegida.
  const buildDibLosaScript = (slabName) => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildDrawSlabBody({ seccionLosa: (slabName || 'LA1D_H25').trim() })
  });
  const buildCargaLosaScript = (slabName) => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildSlabLoadsBody({ cargaCM: Number(slabLoadParams.cargaCM) || 0, cargaCV: Number(slabLoadParams.cargaCV) || 0, filtroPropiedad: (slabName || '').trim(), reemplazar: Boolean(slabLoadParams.reemplazar) })
  });
  const losaNombrePorPaso = { diblosa1d: losa1dParams.nombre, diblosa2d: losa2dParams.nombre, diblosamaciza: losaMacizaParams.nombre, cargalosa1d: losa1dParams.nombre, cargalosa2d: losa2dParams.nombre, cargalosamaciza: losaMacizaParams.nombre };
  const handleCreateDibLosa = (id) => { const s = buildDibLosaScript(losaNombrePorPaso[id]); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, id); };
  const handleInsertDibLosa = (id) => { setPythonCode(buildDibLosaScript(losaNombrePorPaso[id])); setLastCodeFromAi(false); showStatus('success', 'Script de dibujo de losa insertado.'); };
  const handleCreateCargaLosa = (id) => { const s = buildCargaLosaScript(losaNombrePorPaso[id]); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, id); };
  const handleInsertCargaLosa = (id) => { setPythonCode(buildCargaLosaScript(losaNombrePorPaso[id])); setLastCodeFromAi(false); showStatus('success', 'Script de carga de losa insertado.'); };

  const buildCurrentMuroDefScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildWallDefBody({ nombre: (muroDefParams.nombre || 'MURO_E30').trim(), material: (muroDefParams.material || 'CONC_FC210').trim(), espesorCm: Number(muroDefParams.espesorCm) || 30 })
  });
  const handleCreateMuroDef = () => { const s = buildCurrentMuroDefScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'muro'); };
  const handleInsertMuroDef = () => { setPythonCode(buildCurrentMuroDefScript()); setLastCodeFromAi(false); showStatus('success', 'Script de definir muro insertado.'); };

  const buildCurrentMuroDrawScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildWallDrawBody({ propiedad: (muroDrawParams.propiedad || 'MURO_E30').trim(), soloPerimetro: Boolean(muroDrawParams.soloPerimetro), soloPrimerNivel: Boolean(muroDrawParams.soloPrimerNivel) })
  });
  const handleCreateMuroDraw = () => { const s = buildCurrentMuroDrawScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'dibmuro'); };
  const handleInsertMuroDraw = () => { setPythonCode(buildCurrentMuroDrawScript()); setLastCodeFromAi(false); showStatus('success', 'Script de dibujar muro insertado.'); };

  const buildCurrentMuroLoadScript = () => assembleScript({
    modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 6, modelPath: '',
    body: buildWallLoadBody({ propiedad: (muroLoadParams.propiedad || 'MURO_E30').trim(), patron: (muroLoadParams.patron || 'CE').trim(), gammaSuelo: Number(muroLoadParams.gammaSuelo) || 1800, ka: Number(muroLoadParams.ka) || 0.33, alturaM: Number(muroLoadParams.alturaM) || 0, presionDirecta: Number(muroLoadParams.presionDirecta) || 0 })
  });
  const handleCreateMuroLoad = () => { const s = buildCurrentMuroLoadScript(); setPythonCode(s); setLastCodeFromAi(false); executeCode(s, 'cargamuro'); };
  const handleInsertMuroLoad = () => { setPythonCode(buildCurrentMuroLoadScript()); setLastCodeFromAi(false); showStatus('success', 'Script de cargar muro insertado.'); };

  const setAcero = (field, value) => setAceroParams(prev => ({ ...prev, [field]: value }));
  const setMuroDef = (field, value) => setMuroDefParams(prev => ({ ...prev, [field]: value }));
  const setMuroDraw = (field, value) => setMuroDrawParams(prev => ({ ...prev, [field]: value }));
  const setMuroLoad = (field, value) => setMuroLoadParams(prev => ({ ...prev, [field]: value }));

  const setLosaM = (field, value) => setLosaMacizaParams(prev => ({ ...prev, [field]: value }));
  const setLosa1 = (field, value) => setLosa1dParams(prev => ({ ...prev, [field]: value }));
  const setLosa2 = (field, value) => setLosa2dParams(prev => ({ ...prev, [field]: value }));
  const setDrawSlab = (field, value) => setDrawSlabParams(prev => ({ ...prev, [field]: value }));
  const setBeamLoad = (field, value) => setBeamLoadParams(prev => ({ ...prev, [field]: value }));
  const setSlabLoad = (field, value) => setSlabLoadParams(prev => ({ ...prev, [field]: value }));
  const setEspectro = (field, value) => setEspectroParams(prev => ({ ...prev, [field]: value }));
  const setMassSrc = (field, value) => setMassSourceParams(prev => ({ ...prev, [field]: value }));
  const setAutomesh = (field, value) => setAutomeshParams(prev => ({ ...prev, [field]: value }));
  const setDiafragma = (field, value) => setDiafragmaParams(prev => ({ ...prev, [field]: value }));
  const setEndOffset = (field, value) => setEndOffsetParams(prev => ({ ...prev, [field]: value }));

  // "LEER MODELO ABIERTO": lee el modelo real y ACTUALIZA TODO el flujo a partir de lo
  // que esté definido: (1) DIAGNOSTICO -> auto-marca los pasos hechos + materiales/
  // secciones detectadas (sin abrir el modal); (2) GEOMETRIA -> trae frames/areas/grilla
  // al MODELADOR (fuente de grilla = real). Así el diagrama y el Modelador reflejan ETABS.
  const handleReadModel = async () => {
    setExecutionOutput('Leyendo el modelo abierto en ETABS (pasos del flujo + geometria)...');
    const okDiag = await handleDiagnosticar({ abrirModal: false });   // marca pasos + materiales + reporte
    await handleLeerModeloGeo();                                       // geometria -> Modelador
    if (okDiag) {
      showStatus('success', 'Modelo leído: pasos del flujo actualizados + geometría traída al Modelador.');
    } else {
      setExecutionOutput('No se pudo leer el modelo: no hay ETABS abierto, la instancia esta colgada, o el servidor necesita reinicio (banner rojo).');
    }
  };

  const handleSaveGridPattern = () => {
    saveFlowToServer(
      'Crear grilla (NewGridOnly)',
      buildCurrentGridScript(),
      'Modelo nuevo con grilla rectangular regular (espaciamiento uniforme).'
    );
  };

  const saveFlowToServer = async (nombre, codigo, descripcion = '') => {
    try {
      const response = await fetch(`${config.pythonUrl}/flujos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, codigo, descripcion })
      });
      const data = await response.json();
      if (data.success && Array.isArray(data.flujos)) {
        setSavedFlows(data.flujos);
        showStatus('success', `Flujo guardado en tu PC: ${data.archivo || 'flujos_validados.json'}`);
        return true;
      }
      showStatus('error', 'No se pudo guardar el flujo en el servidor.');
      return false;
    } catch {
      showStatus('error', 'Servidor no disponible. No se guardo el flujo.');
      return false;
    }
  };

  const handleManualPreflight = async () => {
    const local = runLocalPreflight(pythonCode);
    let serverIssues = [];
    let serverDown = false;
    try {
      const response = await fetch(`${config.pythonUrl}/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pythonCode, strict_safety: false })
      });
      const data = await response.json();
      serverIssues = Array.isArray(data.api_method_issues) ? data.api_method_issues : [];
    } catch {
      serverDown = true;
    }

    const lineas = [];
    if (serverIssues.length) {
      lineas.push('METODOS INEXISTENTES EN LA API (bloqueante):');
      serverIssues.forEach((m, i) => lineas.push(`${i + 1}. ${m}`));
    }
    const localTxt = renderPreflight(local);
    if (localTxt) lineas.push((lineas.length ? '\n' : '') + localTxt);
    if (serverDown) lineas.push('\n(No se pudo validar metodos contra la API: servidor Python no disponible.)');

    const ok = local.ok && serverIssues.length === 0;
    setExecutionOutput(`PREFLIGHT:\n${lineas.join('\n').trim() || 'Sin errores ni advertencias.'}`);
    showStatus(ok ? 'success' : 'error', ok ? 'Preflight aprobado.' : 'Preflight con problemas.');
  };

  const handleListEtabsProcesses = async () => {
    try {
      const response = await fetch(`${config.pythonUrl}/etabs/processes`);
      const data = await response.json();
      if (!data.success) return setExecutionOutput(`Error listando procesos:\n${data.error || ''}`);
      if (!data.procesos.length) {
        setExecutionOutput('PROCESOS ETABS: ninguno activo.');
        return showStatus('success', 'No hay procesos ETABS corriendo.');
      }
      const lineas = data.procesos.map(p => `PID ${p.pid} | ${p.titulo_ventana || 'SIN VENTANA'} | RAM ${p.memoria}${p.zombie ? '  <-- COLGADO (rompe el attach)' : ''}`);
      setExecutionOutput(`PROCESOS ETABS ACTIVOS (${data.total}):\n\n${lineas.join('\n')}\n\nSi hay procesos colgados o versiones viejas, usa "Cerrar procesos ETABS".`);
    } catch {
      showStatus('error', 'No se pudo consultar al servidor.');
    }
  };

  const handleCleanupEtabs = async () => {
    const seguro = window.confirm('Se cerraran TODOS los procesos de ETABS (se pierde el trabajo no guardado). Continuar?');
    if (!seguro) return;
    try {
      const response = await fetch(`${config.pythonUrl}/etabs/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solo_zombies: false })
      });
      const data = await response.json();
      if (!data.success) return setExecutionOutput(`Error en limpieza:\n${data.error || ''}`);
      setExecutionOutput(`LIMPIEZA DE PROCESOS ETABS:\nCerrados: ${data.cerrados.length ? data.cerrados.join(', ') : 'ninguno'}\nErrores: ${data.errores.length ? data.errores.join('; ') : 'ninguno'}\nRestantes: ${data.restantes.length}`);
      showStatus('success', `Procesos cerrados: ${data.cerrados.length}.`);
    } catch {
      showStatus('error', 'No se pudo conectar al servidor.');
    }
  };

  const handleDocSearch = async () => {
    const q = docSearchQuery.trim();
    if (!q) return;
    setDocSearchItems([]);
    setDocSearchMsg('Buscando en la documentacion oficial...');
    try {
      const response = await fetch(`${config.pythonUrl}/api-docs/search?q=${encodeURIComponent(q)}&limit=10`);
      const data = await response.json();
      if (!data.success) {
        setDocSearchMsg(`Error: ${data.error || 'sin respuesta'}`);
        return;
      }
      if (!data.results.length) {
        setDocSearchMsg(`Sin resultados para "${q}" (base con ${data.total_db} entradas oficiales).`);
        return;
      }
      setDocSearchMsg(`${data.results.length} resultados. Pulsa "Insertar plantilla" para convertir un metodo en script ejecutable.`);
      setDocSearchItems(data.results);
    } catch {
      setDocSearchMsg('No se pudo conectar al servidor Python.');
    }
  };

  const handleInsertDocTemplate = (item) => {
    const body = buildDocSnippetBody(item);
    const script = assembleScript({
      modeValue: sessionMode === 'code_only' ? 'attach_or_start_new_model' : sessionMode,
      unidades: Number.parseInt(selectedUnits, 10) || 6,
      modelPath: modelFilePath.trim(),
      body
    });
    setPythonCode(script);
    setLastCodeFromAi(false);
    setLastRunOk(false);
    setIsDocsOpen(false);
    showStatus('success', `Plantilla de ${item.title} insertada. Rellena los valores y ejecuta.`);
  };

  const handleSaveCurrentAsFlow = () => {
    if (!pythonCode.trim()) return showStatus('error', 'El editor esta vacio.');
    if (!lastRunOk) {
      const seguir = window.confirm('Este codigo aun no se ha ejecutado con exito en esta sesion. Guardar de todas formas como flujo validado?');
      if (!seguir) return;
    }
    const nombre = window.prompt('Nombre del flujo (ej: Crear columnas, Material concreto):', '');
    if (!nombre || !nombre.trim()) return;
    saveFlowToServer(nombre.trim(), pythonCode, 'Guardado desde el editor tras funcionar.');
  };

  const handleDeleteLesson = async (leccionId) => {
    try {
      const response = await fetch(`${config.pythonUrl}/lecciones/${leccionId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success && Array.isArray(data.lecciones)) {
        setSavedLessons(data.lecciones);
        showStatus('success', 'Leccion eliminada.');
      }
    } catch {
      showStatus('error', 'No se pudo eliminar la leccion.');
    }
  };

  const handleDeleteFlow = async (flujoId) => {
    try {
      const response = await fetch(`${config.pythonUrl}/flujos/${flujoId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success && Array.isArray(data.flujos)) {
        setSavedFlows(data.flujos);
        showStatus('success', 'Flujo eliminado.');
      }
    } catch {
      showStatus('error', 'No se pudo eliminar el flujo.');
    }
  };

  const handleRunFlow = (flujo) => {
    setPythonCode(flujo.codigo);
    setLastCodeFromAi(false);
    executeCode(flujo.codigo);
  };

  const handleInsertFlow = (flujo) => {
    setPythonCode(flujo.codigo);
    setLastCodeFromAi(false);
    showStatus('success', `Flujo "${flujo.nombre}" insertado en el editor.`);
  };

  const handleRepair = () => {
    const errorText = lastError || executionOutput;
    if (!errorText.trim()) return showStatus('error', 'No hay error para reparar.');
    requestAiCode({ instruction: 'Repara el codigo actual', isRepair: true, errorText });
  };

  const handleCopyReport = async () => {
    const informe = [
      `=== INFORME ETABS API + IA ${APP_VERSION} ===`,
      `Fecha: ${new Date().toLocaleString()}`,
      `Modo: ${activeMode.label} | Unidades: ${selectedUnits} | IA: ${activeLabel} (${activeModel || 'sin modelo'})`,
      '',
      '--- ERROR / SALIDA DE TERMINAL ---',
      lastError || executionOutput || '(sin salida)',
      '',
      '--- CODIGO DEL EDITOR ---',
      '```python',
      pythonCode,
      '```'
    ].join('\n');
    try {
      await navigator.clipboard.writeText(informe);
      showStatus('success', 'Informe copiado. Pegalo donde quieras reportarlo.');
    } catch {
      const area = document.createElement('textarea');
      area.value = informe;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
      showStatus('success', 'Informe copiado al portapapeles.');
    }
  };

  // ----- Vista de FLUJO DE TRABAJO (pasos guiados con dependencias) -----
  const inputCls = "w-full bg-black/30 border border-white/10 px-2.5 py-2 rounded-lg text-xs text-slate-100 font-mono outline-none transition-colors duration-150 hover:border-white/20 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15 placeholder:text-slate-600";
  const lblCls = "text-[9px] text-slate-400 font-bold uppercase tracking-wider block mb-1";

  const botonesEjecutar = (onRun, onInsert) => (
    <div className="flex flex-col gap-2 mt-3">
      <button onClick={() => { setOpenStep(''); onRun(); }} disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase text-white flex items-center justify-center gap-2 transition-colors"><Play size={13} /> Ejecutar en ETABS</button>
      {onInsert && <button onClick={() => { onInsert(); setOpenStep(''); setMainTab('codigo'); }} className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-cyan-200 transition-colors">Insertar en editor (ver codigo)</button>}
    </div>
  );

  const ordsGridX = ordenadasDeLuces(gridParams.espaciamientosX);
  const ordsGridY = ordenadasDeLuces(gridParams.espaciamientosY);
  const altsGrid = parseAlturasPisos(gridParams.alturasPisos);
  const altTotalGrid = altsGrid.reduce((a, b) => a + b, 0);
  // Ejes inclinados con coordenadas numericas validas (para el preview y el resumen).
  const ejesIncPreview = (gridParams.ejesInclinados || [])
    .map((e, i) => ({ id: e.id || `EI${i + 1}`, x1: Number(e.x1), y1: Number(e.y1), x2: Number(e.x2), y2: Number(e.y2), bubble: e.bubble }))
    .filter(e => [e.x1, e.y1, e.x2, e.y2].every(Number.isFinite) && (e.x1 !== e.x2 || e.y1 !== e.y2));
  const formGrid = (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-3">
        <label className={lblCls}>Alturas de piso — una por piso, de abajo hacia arriba (m)</label>
        <input value={gridParams.alturasPisos} onChange={e => setGrid('alturasPisos', e.target.value)} placeholder="4, 5, 5   (o con multiplicador: 4 2*5)" className={inputCls} />
        <p className="text-[8px] text-slate-500 mt-1">{altsGrid.length} piso(s) · alturas [{altsGrid.join(', ')}] m · altura total {altTotalGrid.toFixed(2)} m · cotas Z [{nivelesDeAlturas(altsGrid).join(', ')}]</p>
        <p className="text-[8px] text-slate-500">Estilo Tekla: una altura por piso (la 1ª es el primer piso). Usa <b className="text-cyan-300">n*h</b> para repetir — ej. <b className="text-cyan-300">4 2*5</b> = un piso de 4 m y dos de 5 m.</p>
      </div>
      <div className="col-span-3">
        <label className={lblCls}>Luces en X — separacion entre ejes 1,2,3… (m)</label>
        <input value={gridParams.espaciamientosX} onChange={e => setGrid('espaciamientosX', e.target.value)} placeholder="5, 4, 6, 5" className={inputCls} />
        <p className="text-[8px] text-slate-500 mt-1">{ordsGridX.length} ejes · ancho total {ordsGridX[ordsGridX.length - 1]} m · ordenadas [{ordsGridX.join(', ')}]</p>
      </div>
      <div className="col-span-3">
        <label className={lblCls}>Luces en Y — separacion entre ejes A,B,C… (m)</label>
        <input value={gridParams.espaciamientosY} onChange={e => setGrid('espaciamientosY', e.target.value)} placeholder="5, 4, 5" className={inputCls} />
        <p className="text-[8px] text-slate-500 mt-1">{ordsGridY.length} ejes · fondo total {ordsGridY[ordsGridY.length - 1]} m · ordenadas [{ordsGridY.join(', ')}]</p>
      </div>
      <details className="col-span-3 bg-amber-500/[0.04] border border-amber-500/20 rounded-lg overflow-hidden">
        <summary className="cursor-pointer select-none px-3 py-2 text-[9px] font-black uppercase tracking-wider text-amber-300/90 hover:bg-amber-500/10">📷 Detectar ejes desde una imagen (opcional · IA)</summary>
        <div className="px-3 pb-3 pt-1">
          <p className="text-[8.5px] text-slate-500 mb-2 leading-relaxed">Sube una foto o captura del plano (con ejes en burbujas y cotas). La IA (<b className="text-amber-300">{activeLabel}</b>) lee las luces ortogonales y rellena los campos de arriba. Si hay ejes inclinados, agrégalos a mano abajo (la IA los toma como ortogonales). <b className="text-amber-300">Revisa siempre</b> los valores contra el plano antes de crear la grilla — la IA puede equivocarse leyendo cotas.</p>
          <input type="file" accept="image/*" disabled={imgGridBusy} onChange={e => { handleDetectGridFromImage(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-[9px] text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-amber-500/30 file:bg-amber-500/10 file:text-amber-300 file:text-[9px] file:font-black file:uppercase file:cursor-pointer hover:file:bg-amber-500/20 disabled:opacity-50" />
          {imgGridMsg && <p className={`text-[8.5px] mt-2 leading-relaxed ${imgGridBusy ? 'text-cyan-300' : imgGridMsg.startsWith('✓') ? 'text-emerald-300' : 'text-amber-300/90'}`}>{imgGridBusy ? '⏳ ' : ''}{imgGridMsg}</p>}
        </div>
      </details>
      <details className="col-span-3 bg-cyan-500/[0.04] border border-cyan-500/20 rounded-lg overflow-hidden">
        <summary className="cursor-pointer select-none px-3 py-2 text-[9px] font-black uppercase tracking-wider text-cyan-300/90 hover:bg-cyan-500/10">📐 Importar ejes desde CAD (DXF) — opcional</summary>
        <div className="px-3 pb-3 pt-1">
          <p className="text-[8.5px] text-slate-500 mb-2 leading-relaxed">El <b className="text-cyan-300">.dwg es binario</b> y no se puede leer: expórtalo a <b className="text-cyan-300">DXF</b> (en tu CAD: comando <b className="text-cyan-300">DXFOUT</b> o Guardar como → DXF, ASCII). Sube el .dxf y se leen las luces ortogonales y los <b className="text-cyan-300">ejes inclinados</b> (líneas no ortogonales). <b className="text-cyan-300">Revisa</b> contra el plano.</p>
          <input type="file" accept=".dxf,text/plain" onChange={e => { handleImportDxf(e.target.files?.[0]); e.target.value = ''; }} className="block w-full text-[9px] text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-cyan-500/30 file:bg-cyan-500/10 file:text-cyan-300 file:text-[9px] file:font-black file:uppercase file:cursor-pointer hover:file:bg-cyan-500/20" />
          {dxfState.layers.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <div><label className="text-[8px] text-slate-500 font-bold uppercase block mb-0.5">Capa de ejes</label>
                <select value={dxfState.capa} onChange={e => { const capa = e.target.value; if (dxfState.segments) aplicarDxf(dxfState.segments, capa, dxfState.unidad); }} className="w-full bg-black/30 border border-white/10 px-2 py-1.5 rounded text-[10px] text-slate-100 outline-none focus:border-cyan-400/60">
                  <option value="(todas)">(todas las capas) · {dxfState.segments?.length || 0}</option>
                  {dxfState.layers.map(l => <option key={l} value={l}>{l} · {(dxfState.layerCounts || {})[l] || 0}</option>)}
                </select>
              </div>
              <div><label className="text-[8px] text-slate-500 font-bold uppercase block mb-0.5">Unidad del dibujo</label>
                <select value={dxfState.unidad} onChange={e => { const unidad = e.target.value; if (dxfState.segments) aplicarDxf(dxfState.segments, dxfState.capa, unidad); }} className="w-full bg-black/30 border border-white/10 px-2 py-1.5 rounded text-[10px] text-slate-100 outline-none focus:border-cyan-400/60">
                  <option value="auto">Auto</option>
                  <option value="m">Metros</option>
                  <option value="cm">Centímetros</option>
                  <option value="mm">Milímetros</option>
                </select>
              </div>
            </div>
          )}
          {dxfState.msg && <p className={`text-[8.5px] mt-2 leading-relaxed ${dxfState.msg.startsWith('✓') ? 'text-emerald-300' : 'text-cyan-300/90'}`}>{dxfState.msg}</p>}
        </div>
      </details>
      <div className="col-span-3 border-t border-white/10 pt-3 mt-1">
        <div className="flex items-center justify-between mb-1.5">
          <label className={`${lblCls} mb-0`}>Ejes inclinados (opcional) — por 2 puntos</label>
          <button onClick={addEjeInclinado} className="bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg text-[8.5px] font-black uppercase tracking-wide transition-colors">+ Agregar eje</button>
        </div>
        <p className="text-[8px] text-slate-500 mb-2">Un eje no ortogonal se crea como línea <b className="text-amber-300">«General (Cartesian)»</b> definida por sus 2 extremos en planta (m). Útil para bordes oblicuos. Se muestra en ámbar en la vista previa.</p>
        {(gridParams.ejesInclinados || []).length === 0 ? (
          <p className="text-[8px] text-slate-600 italic">Sin ejes inclinados. Pulsa «+ Agregar eje» si tu planta tiene un borde oblicuo.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[2.2rem_1fr_1fr_1fr_1fr_1.4rem] gap-1.5 px-0.5">
              {['ID', 'X1', 'Y1', 'X2', 'Y2', ''].map((h, i) => <span key={i} className="text-[7.5px] text-slate-500 font-black uppercase text-center">{h}</span>)}
            </div>
            {(gridParams.ejesInclinados || []).map((e, idx) => (
              <div key={idx} className="grid grid-cols-[2.2rem_1fr_1fr_1fr_1fr_1.4rem] gap-1.5 items-center min-w-0">
                <input value={e.id} onChange={ev => setEjeInclinado(idx, 'id', ev.target.value)} className="w-full min-w-0 bg-black/30 border border-white/10 px-1 py-1.5 rounded text-[10px] text-amber-300 font-mono text-center outline-none focus:border-amber-400/60" />
                <input value={e.x1} onChange={ev => setEjeInclinado(idx, 'x1', ev.target.value)} placeholder="0" inputMode="decimal" className="w-full min-w-0 bg-black/30 border border-white/10 px-1.5 py-1.5 rounded text-[10px] text-slate-100 font-mono text-center outline-none focus:border-cyan-400/60" />
                <input value={e.y1} onChange={ev => setEjeInclinado(idx, 'y1', ev.target.value)} placeholder="0" inputMode="decimal" className="w-full min-w-0 bg-black/30 border border-white/10 px-1.5 py-1.5 rounded text-[10px] text-slate-100 font-mono text-center outline-none focus:border-cyan-400/60" />
                <input value={e.x2} onChange={ev => setEjeInclinado(idx, 'x2', ev.target.value)} placeholder="15" inputMode="decimal" className="w-full min-w-0 bg-black/30 border border-white/10 px-1.5 py-1.5 rounded text-[10px] text-slate-100 font-mono text-center outline-none focus:border-cyan-400/60" />
                <input value={e.y2} onChange={ev => setEjeInclinado(idx, 'y2', ev.target.value)} placeholder="9" inputMode="decimal" className="w-full min-w-0 bg-black/30 border border-white/10 px-1.5 py-1.5 rounded text-[10px] text-slate-100 font-mono text-center outline-none focus:border-cyan-400/60" />
                <button onClick={() => removeEjeInclinado(idx)} title="Quitar este eje" className="text-slate-600 hover:text-red-400 flex justify-center"><X size={13} /></button>
              </div>
            ))}
            <p className="text-[8px] text-slate-500 pt-0.5">{ejesIncPreview.length} eje(s) inclinado(s) válido(s){ejesIncPreview.length < (gridParams.ejesInclinados || []).length ? ' · completa los 4 valores de los demás' : ''}.</p>
          </div>
        )}
      </div>
      <p className="col-span-3 text-[8px] text-slate-500 -mt-1">La grilla (alturas y luces no uniformes) se arma por la tabla de grillas de ETABS (API pura, sin archivos).</p>
    </div>
  );

  const formMaterial = (
    <div className="grid grid-cols-3 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={matParams.nombre} onChange={e => setMat('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>f'c (kg/cm2)</label><input type="number" step="5" value={matParams.fc} onChange={e => setMat('fc', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Peso (kgf/m3)</label><input type="number" step="50" value={matParams.peso} onChange={e => setMat('peso', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formViga = (
    <div className="grid grid-cols-2 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={vigaParams.nombre} onChange={e => setViga('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={vigaParams.material} onChange={e => setViga('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Base b (cm)</label><input type="number" step="5" value={vigaParams.baseCm} onChange={e => setViga('baseCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Altura h (cm)</label><input type="number" step="5" value={vigaParams.alturaCm} onChange={e => setViga('alturaCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Mat. refuerzo</label><input list="mats-acero" value={vigaParams.matRefuerzo} onChange={e => setViga('matRefuerzo', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Recubrim. (cm)</label><input type="number" step="0.5" value={vigaParams.recubCm} onChange={e => setViga('recubCm', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formColumna = (
    <div className="grid grid-cols-2 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={colParams.nombre} onChange={e => setCol('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={colParams.material} onChange={e => setCol('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Base b (cm)</label><input type="number" step="5" value={colParams.baseCm} onChange={e => setCol('baseCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Altura h (cm)</label><input type="number" step="5" value={colParams.alturaCm} onChange={e => setCol('alturaCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Mat. refuerzo</label><input list="mats-acero" value={colParams.matRefuerzo} onChange={e => setCol('matRefuerzo', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Recubrim. (cm)</label><input type="number" step="0.5" value={colParams.recubCm} onChange={e => setCol('recubCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Barras cara dir 3</label><input type="number" min="2" value={colParams.barras3} onChange={e => setCol('barras3', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Barras cara dir 2</label><input type="number" min="2" value={colParams.barras2} onChange={e => setCol('barras2', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Barra long. (mm)</label><input value={colParams.barraLong} onChange={e => setCol('barraLong', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Estribo (mm) / esp (cm)</label><div className="flex gap-2"><input value={colParams.barraEstribo} onChange={e => setCol('barraEstribo', e.target.value)} className={inputCls} /><input type="number" step="2.5" value={colParams.espEstriboCm} onChange={e => setCol('espEstriboCm', e.target.value)} className={inputCls} /></div></div>
    </div>
  );

  const formDraw = (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div><label className={lblCls}>Seccion columna</label><input value={drawParams.seccionColumna} onChange={e => setDraw('seccionColumna', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Seccion viga</label><input value={drawParams.seccionViga} onChange={e => setDraw('seccionViga', e.target.value)} className={inputCls} /></div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={drawParams.vigasX} onChange={e => setDraw('vigasX', e.target.checked)} />Vigas X</label>
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={drawParams.vigasY} onChange={e => setDraw('vigasY', e.target.checked)} />Vigas Y</label>
      </div>
    </div>
  );

  const formApoyos = (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer"><input type="radio" name="fApoyo" className="accent-cyan-500" checked={apoyoEmpotrado} onChange={() => setApoyoEmpotrado(true)} />Empotrado</label>
      <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer"><input type="radio" name="fApoyo" className="accent-cyan-500" checked={!apoyoEmpotrado} onChange={() => setApoyoEmpotrado(false)} />Articulado</label>
    </div>
  );

  const formPatrones = (
    <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={patParams.incluirCE} onChange={e => setPat('incluirCE', e.target.checked)} />Incluir patron CE</label>
  );

  const formMassSource = (
    <div>
      <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Fuente de masa sísmica E.030: <b className="text-cyan-300">peso = factor·CM + factor·CV</b> (los factores son los mismos del Espectro). Para edificios comunes E.030: <b>100% CM + 25% CV</b> (vivienda/oficina) o <b>50% CV</b> (depósitos/almacenes).</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lblCls}>Patrón CM</label><input value={massSourceParams.patronCM} onChange={e => setMassSrc('patronCM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Factor CM</label><input type="number" step="0.05" value={espectroParams.masaCM} onChange={e => setEspectro('masaCM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Patrón CV</label><input value={massSourceParams.patronCV} onChange={e => setMassSrc('patronCV', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Factor CV</label><input type="number" step="0.05" value={espectroParams.masaCV} onChange={e => setEspectro('masaCV', e.target.value)} className={inputCls} /></div>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer mt-3"><input type="checkbox" className="accent-cyan-500" checked={massSourceParams.incluirElementos} onChange={e => setMassSrc('incluirElementos', e.target.checked)} />Incluir peso propio de los elementos (además de las cargas)</label>
      <p className="text-[9px] text-amber-400/80 mt-2">⚠️ Si el patrón CM ya incluye el peso propio (multiplicador de peso propio = 1), deja esto <b>desmarcado</b> para no contar la masa dos veces. Es lo mismo que aplica el paso Espectro.</p>
    </div>
  );

  const formAutomesh = (
    <div>
      <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Replica los diálogos <b className="text-cyan-300">Floor / Wall Auto Mesh Options</b> de ETABS. Como en el GUI, <b className="text-amber-300">primero se seleccionan</b> las áreas y luego se asigna: <b className="text-cyan-300">losas</b> = «Auto Cookie Cut» (malla en vigas y bordes de muro, hasta el tamaño máx.); <b className="text-cyan-300">muros</b> = «Auto Rectangular Mesh» (tamaño máx. global). Se asigna por tablas de ETABS (la API no expone SetAutoMesh).</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lblCls}>Aplicar a</label>
          <select value={automeshParams.soloTipo} onChange={e => setAutomesh('soloTipo', e.target.value)} className={inputCls}>
            <option value="todas">Todas las áreas (losas + muros)</option>
            <option value="losas">Solo losas</option>
            <option value="muros">Solo muros</option>
          </select>
        </div>
        <div><label className={lblCls}>Tamaño máx. de elemento (m)</label>
          <input type="number" step="0.05" min="0.1" value={automeshParams.maxSize} onChange={e => setAutomesh('maxSize', e.target.value)} className={inputCls} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer mt-3 select-none">
        <input type="checkbox" className="accent-cyan-500" checked={automeshParams.atGrids} onChange={e => setAutomesh('atGrids', e.target.checked)} />
        Mallar losas también en las grillas visibles (por defecto OFF, como el diálogo)
      </label>
      <p className="text-[9px] text-slate-600 mt-2">Losas: cookie cut + sub-malla a {Number(automeshParams.maxSize) > 0 ? automeshParams.maxSize : '0.7'} m. Muros: malla rectangular a {Number(automeshParams.maxSize) > 0 ? automeshParams.maxSize : '0.7'} m (tamaño global). Validado en vivo (ETABS 22).</p>
    </div>
  );

  const formDiafragma = (
    <div>
      <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Define el diafragma y lo asigna <b className="text-amber-300">por punto</b> (como Assign &gt; Joint &gt; Diaphragms) a los nudos de los pisos elegidos. La <b className="text-cyan-300">base (apoyos) nunca</b> recibe diafragma. ETABS agrupa por nivel → un diafragma rígido independiente por piso.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lblCls}>Nombre del diafragma</label><input value={diafragmaParams.nombre} onChange={e => setDiafragma('nombre', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Rigidez</label>
          <select value={diafragmaParams.semiRigido ? 'semi' : 'rigido'} onChange={e => setDiafragma('semiRigido', e.target.value === 'semi')} className={inputCls}>
            <option value="rigido">Rígido</option>
            <option value="semi">Semi-rígido</option>
          </select>
        </div>
        <div><label className={lblCls}>Aplicar a</label>
          <select value={diafragmaParams.alcance} onChange={e => setDiafragma('alcance', e.target.value)} className={inputCls}>
            <option value="todos">Todos los pisos (menos la base)</option>
            <option value="especificos">Pisos específicos…</option>
          </select>
        </div>
        {diafragmaParams.alcance === 'especificos' && (
          <div><label className={lblCls}>Pisos (separados por coma)</label><input value={diafragmaParams.pisos} onChange={e => setDiafragma('pisos', e.target.value)} placeholder="Story1, Story3, Story5" className={inputCls} /></div>
        )}
      </div>
      <button onClick={handleCheckDiafragma} disabled={isLoading} className="w-full mt-3 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">🔎 Verificar diafragmas por piso (qué piso no tiene)</button>
      <p className="text-[9px] text-slate-600 mt-2">El diagnóstico (solo lectura) lista, piso por piso, cuántos nudos tienen diafragma rígido y avisa de los pisos SIN diafragma. cDiaphragm.SetDiaphragm + cPointObj.SetDiaphragm (DefinedDiaphragm). Validado en vivo (ETABS 22).</p>
    </div>
  );

  const formEndOffset = (
    <div>
      <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Asigna los <b className="text-cyan-300">brazos rígidos</b> (End Length Offsets) a vigas y columnas, como el diálogo <b className="text-cyan-300">Frame Assignment</b>. En automático ETABS calcula el offset desde la conectividad y el <b className="text-amber-300">factor de zona rígida</b> define cuánto es rígido.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lblCls}>Modo</label>
          <select value={endOffsetParams.auto ? 'auto' : 'manual'} onChange={e => setEndOffset('auto', e.target.value === 'auto')} className={inputCls}>
            <option value="auto">Automático (desde conectividad)</option>
            <option value="manual">Definir longitudes</option>
          </select>
        </div>
        <div><label className={lblCls}>Factor de zona rígida (0–1)</label><input type="number" step="0.05" min="0" max="1" value={endOffsetParams.rzFactor} onChange={e => setEndOffset('rzFactor', e.target.value)} className={inputCls} /></div>
        {!endOffsetParams.auto && <div><label className={lblCls}>End-I (m)</label><input type="number" step="0.05" value={endOffsetParams.lenI} onChange={e => setEndOffset('lenI', e.target.value)} className={inputCls} /></div>}
        {!endOffsetParams.auto && <div><label className={lblCls}>End-J (m)</label><input type="number" step="0.05" value={endOffsetParams.lenJ} onChange={e => setEndOffset('lenJ', e.target.value)} className={inputCls} /></div>}
        <div className={endOffsetParams.auto ? 'col-span-2' : ''}><label className={lblCls}>Aplicar a</label>
          <select value={endOffsetParams.tipo} onChange={e => setEndOffset('tipo', e.target.value)} className={inputCls}>
            <option value="todas">Vigas y columnas</option>
            <option value="vigas">Solo vigas</option>
            <option value="columnas">Solo columnas</option>
          </select>
        </div>
      </div>
      <p className="text-[9px] text-slate-600 mt-2">Automático: factor de zona rígida vía tabla de ETABS (la API con auto no lo guarda); manual: cFrameObj.SetEndLengthOffset. Clasifica con GetDesignOrientation. Validado en vivo (ETABS 22).</p>
    </div>
  );

  const setRel = (campo, valor) => setReleaseParams(prev => ({ ...prev, [campo]: valor }));
  const formRelease = (
    <div>
      <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Libera momentos en las vigas que elijas (como <b className="text-cyan-300">Assign &gt; Frame &gt; Releases</b>). Flujo: <b className="text-amber-300">1)</b> en ETABS <b className="text-amber-300">selecciona las vigas</b> (clic o ventana); <b className="text-amber-300">2)</b> elige qué liberar; <b className="text-amber-300">3)</b> Asignar. Se aplica a la <b className="text-cyan-300">selección actual de ETABS</b>.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lblCls}>Aplicar a</label>
          <select value={releaseParams.alcance} onChange={e => setRel('alcance', e.target.value)} className={inputCls}>
            <option value="seleccion">La selección actual en ETABS</option>
            <option value="todas">Todas las vigas</option>
            <option value="seccion">Vigas de una sección…</option>
          </select>
        </div>
        {releaseParams.alcance === 'seccion'
          ? <div><label className={lblCls}>Sección de viga</label><input value={releaseParams.filtroSeccion} onChange={e => setRel('filtroSeccion', e.target.value)} placeholder="V-25x50" className={inputCls} /></div>
          : <div className="flex items-end pb-1"><label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.soloVigas} onChange={e => setRel('soloVigas', e.target.checked)} />Solo vigas (ignora columnas)</label></div>}
      </div>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Liberaciones de extremo</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.m3i} onChange={e => setRel('m3i', e.target.checked)} />Momento mayor M3 · extremo i</label>
          <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.m3j} onChange={e => setRel('m3j', e.target.checked)} />Momento mayor M3 · extremo j</label>
          <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.m2i} onChange={e => setRel('m2i', e.target.checked)} />Momento menor M2 · extremo i</label>
          <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.m2j} onChange={e => setRel('m2j', e.target.checked)} />Momento menor M2 · extremo j</label>
          <label className="flex items-center gap-2 text-[10px] text-slate-300 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={releaseParams.torsionJ} onChange={e => setRel('torsionJ', e.target.checked)} />Torsión · extremo j</label>
        </div>
      </div>
      <button onClick={handleCheckRelease} disabled={isLoading} className="w-full mt-3 bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">🔎 Leer selección de ETABS (cuántas vigas hay seleccionadas)</button>
      <p className="text-[9px] text-slate-600 mt-2">Liberar <b>M3 en i y j</b> = viga rotulada a flexión (típico de vigas secundarias/de gravedad). cFrameObj.SetReleases; ETABS rechaza combinaciones inestables (se reporta cuáles). En modo «selección», recuerda seleccionar las vigas en ETABS antes de Asignar.</p>
    </div>
  );

  // Verificacion AUTOMATICA de la irregularidad de MASA o PESO: lee las masas por piso
  // del modelo (reusa /etabs/extraer-modelo -> "Mass Summary by Story", ya validado) y
  // aplica el criterio P_piso > 1,5*P_adyacente (calcMasaIrreg). Si la detecta, marca
  // 'masa' en AMBAS direcciones (la masa no es direccional) -> baja Ia a 0,90 y R.
  const handleVerifMasa = useCallback(async () => {
    setVerifMasa({ loading: true });
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/extraer-modelo?pid=${instanciaPid}`);
      const data = await r.json();
      if (!r.ok || data.error) { setVerifMasa({ error: data.error || 'No se pudo leer el modelo de ETABS.' }); return; }
      const masas = data.masas_piso || [];
      const totalMasa = masas.reduce((s, m) => s + Math.max(Number(m.masa_x) || 0, Number(m.masa_y) || 0), 0);
      if (!masas.length || totalMasa <= 0) {
        setVerifMasa({ error: 'Las masas por piso salen en 0. Corre el análisis (Mass Source + 1er análisis) y vuelve a verificar.' });
        return;
      }
      const { filas, irregular } = calcMasaIrreg(masas);
      if (!filas.length) { setVerifMasa({ error: 'No se identificaron pisos con masa.' }); return; }
      // La masa no es direccional: marca/desmarca 'masa' en X e Y segun el resultado.
      setDisenoEspectro(prev => {
        const setM = arr => { const a = (arr || []).filter(x => x !== 'masa'); if (irregular) a.push('masa'); return a; };
        return { ...prev, iaX: setM(prev.iaX), iaY: setM(prev.iaY) };
      });
      setVerifMasa({ filas, irregular });
      showStatus(irregular ? 'error' : 'success', irregular
        ? 'Irregularidad de masa DETECTADA (un piso > 1,5× un adyacente) — marcada en X e Y (Ia = 0,90).'
        : 'Sin irregularidad de masa: ningún piso evaluable supera 1,5× un adyacente.');
    } catch {
      setVerifMasa({ error: 'No se pudo conectar al servidor.' });
    }
  }, [config.pythonUrl, instanciaPid]);

  // Verificacion AUTOMATICA de la irregularidad TORSIONAL: lee la razon Δmax/Δprom por piso
  // (endpoint /etabs/torsion -> tabla "Story Max Over Avg Drifts") para los casos sismicos y
  // aplica el criterio E.030 por DIRECCION (X/Y independientes): >1,3 torsional / >1,5 extrema,
  // solo en pisos con Δmax > 50% del permisible. Marca torsion/torsionExt en ipX/ipY -> R.
  const handleVerifTorsion = useCallback(async () => {
    setVerifTorsion({ loading: true });
    try {
      const casos = [...new Set([espectroParams.casoX, espectroParams.casoY,
        comboParams.casoSismoX, comboParams.casoSismoY, 'CSX', 'CSY', 'DERVX', 'DERVY'].filter(Boolean))];
      const q = encodeURIComponent(casos.join(','));
      const r = await fetch(`${config.pythonUrl}/etabs/torsion?pid=${instanciaPid}&casos=${q}`);
      const data = await r.json();
      if (!r.ok || data.error) { setVerifTorsion({ error: data.error || 'No se pudo leer la torsión del modelo.' }); return; }
      const drifts = data.drifts || [];
      if (!drifts.length) {
        setVerifTorsion({ error: 'Sin datos de Δmax/Δprom. Corre el análisis sísmico (casos espectrales CSX/CSY con diafragma rígido) y vuelve a verificar.' });
        return;
      }
      const res = calcTorsionIrreg(drifts);
      setDisenoEspectro(prev => {
        const setDir = (arr, tipo) => { const a = (arr || []).filter(x => x !== 'torsion' && x !== 'torsionExt'); if (tipo) a.push(tipo); return a; };
        return { ...prev, ipX: setDir(prev.ipX, res.x.tipo), ipY: setDir(prev.ipY, res.y.tipo) };
      });
      setVerifTorsion({ res });
      const txt = (lbl, o) => `${lbl}: ${o.ratioMax ? o.ratioMax.toFixed(2) + '×' : '—'}${o.tipo ? (o.tipo === 'torsionExt' ? ' EXTREMA' : ' torsional') : ''}`;
      const hay = res.x.tipo || res.y.tipo;
      showStatus(hay ? 'error' : 'success', `Torsión — ${txt('X', res.x)} · ${txt('Y', res.y)}.`);
    } catch {
      setVerifTorsion({ error: 'No se pudo conectar al servidor.' });
    }
  }, [config.pythonUrl, instanciaPid, espectroParams.casoX, espectroParams.casoY, comboParams.casoSismoX, comboParams.casoSismoY]);

  // Verificacion AUTOMATICA de la irregularidad de RIGIDEZ / PISO BLANDO: lee la rigidez
  // lateral de entrepiso (endpoint /etabs/rigidez -> tabla "Story Stiffness") por los casos
  // sismicos X e Y y aplica el criterio E.030 por DIRECCION: K<0,70·K_sup (o <0,80·prom3) =>
  // piso blando; K<0,60·K_sup (o <0,70·prom3) => extrema. Marca rigidez/rigidezExt en iaX/iaY.
  const handleVerifRigidez = useCallback(async () => {
    setVerifRigidez({ loading: true });
    try {
      const cx = espectroParams.casoX || 'CSX', cy = espectroParams.casoY || 'CSY';
      const casos = [...new Set([cx, cy, 'CSX', 'CSY'].filter(Boolean))];
      const q = encodeURIComponent(casos.join(','));
      const r = await fetch(`${config.pythonUrl}/etabs/rigidez?pid=${instanciaPid}&casos=${q}`);
      const data = await r.json();
      if (!r.ok || data.error) { setVerifRigidez({ error: data.error || 'No se pudo leer la rigidez del modelo.' }); return; }
      const rows = data.rigidez || [];
      if (!rows.length) {
        setVerifRigidez({ error: 'Sin datos de rigidez de entrepiso. Corre el análisis sísmico (casos CSX/CSY) y vuelve a verificar.' });
        return;
      }
      const res = calcRigidezIrreg(rows, cx, cy);
      setDisenoEspectro(prev => {
        const setDir = (arr, tipo) => { const a = (arr || []).filter(x => x !== 'rigidez' && x !== 'rigidezExt'); if (tipo) a.push(tipo); return a; };
        return { ...prev, iaX: setDir(prev.iaX, res.x.tipo), iaY: setDir(prev.iaY, res.y.tipo) };
      });
      setVerifRigidez({ res });
      const txt = (lbl, o) => `${lbl}: ${o.peor ? `${(o.peor.rel ?? 0).toFixed(2)}×` : 'ok'}${o.tipo ? (o.tipo === 'rigidezExt' ? ' EXTREMA' : ' blando') : ''}`;
      const hay = res.x.tipo || res.y.tipo;
      showStatus(hay ? 'error' : 'success', `Rigidez (piso blando) — ${txt('X', res.x)} · ${txt('Y', res.y)}.`);
    } catch {
      setVerifRigidez({ error: 'No se pudo conectar al servidor.' });
    }
  }, [config.pythonUrl, instanciaPid, espectroParams.casoX, espectroParams.casoY]);

  // Verificacion AUTOMATICA de las irregularidades GEOMETRICAS (NO necesitan analisis): lee la
  // geometria del modelo (/etabs/modelo-geometria) UNA vez y calcula Geometrica vertical (Ia),
  // Discontinuidad del diafragma (Ip) y Sistemas no paralelos (Ip). Marca geomVert/diafragma/
  // noParalelo en disenoEspectro -> R. Un solo boton (en las 3 tarjetas) dispara todo.
  const handleVerifGeom = useCallback(async () => {
    setVerifGeom({ loading: true });
    try {
      const r = await fetch(`${config.pythonUrl}/etabs/modelo-geometria?pid=${instanciaPid}`);
      const data = await r.json();
      if (!r.ok || data.error) { setVerifGeom({ error: data.error || 'No se pudo leer la geometría del modelo.' }); return; }
      const els = data.elementos || [];
      if (!els.length) { setVerifGeom({ error: 'El modelo no tiene geometría legible (¿está vacío?).' }); return; }
      const vertical = calcGeomVertical(els);
      const diafragma = calcDiafragmaIrreg(els);
      const noParalelo = calcNoParaleloIrreg(els);
      const esquinas = calcEsquinasIrreg(els);
      setDisenoEspectro(prev => {
        const set = (arr, id, on) => { const a = (arr || []).filter(x => x !== id); if (on) a.push(id); return a; };
        const setP = (arr) => set(set(set(arr, 'diafragma', diafragma.irregular), 'noParalelo', noParalelo.irregular), 'esquinas', esquinas.irregular);
        return {
          ...prev,
          iaX: set(prev.iaX, 'geomVert', vertical.x.irregular),
          iaY: set(prev.iaY, 'geomVert', vertical.y.irregular),
          ipX: setP(prev.ipX),
          ipY: setP(prev.ipY),
        };
      });
      setVerifGeom({ vertical, diafragma, noParalelo, esquinas });
      const flags = [];
      if (vertical.x.irregular || vertical.y.irregular) flags.push('geométrica vertical');
      if (diafragma.irregular) flags.push('diafragma');
      if (noParalelo.irregular) flags.push('sistemas no paralelos');
      if (esquinas.irregular) flags.push('esquinas entrantes');
      showStatus(flags.length ? 'error' : 'success', flags.length
        ? `Irregularidad geométrica: ${flags.join(', ')} (marcadas → R).`
        : 'Geometría regular: sin irregularidad vertical, de diafragma ni de sistemas no paralelos.');
    } catch {
      setVerifGeom({ error: 'No se pudo conectar al servidor.' });
    }
  }, [config.pythonUrl, instanciaPid]);

  // Verificacion del SISTEMA ESTRUCTURAL: lee el % del cortante basal que toman los muros por
  // direccion (endpoint /etabs/cortante-sistema -> Pier Forces V2 + BaseReact) y rellena los
  // campos editables; la clasificacion (Tabla N°8) y la aplicacion del R0 las hace el formulario.
  const handleVerifSistema = useCallback(async () => {
    setVerifSistema({ loading: true });
    try {
      const cx = espectroParams.casoX || 'CSX', cy = espectroParams.casoY || 'CSY';
      const r = await fetch(`${config.pythonUrl}/etabs/cortante-sistema?pid=${instanciaPid}&casoX=${encodeURIComponent(cx)}&casoY=${encodeURIComponent(cy)}`);
      const data = await r.json();
      if (!r.ok || data.error) { setVerifSistema({ error: data.error || 'No se pudo leer el cortante del modelo.' }); return; }
      if ((data.vTotalX || 0) <= 0 && (data.vTotalY || 0) <= 0) {
        setVerifSistema({ error: `Cortante basal en 0. Corre el análisis sísmico (casos ${cx}/${cy}) y vuelve a verificar.` });
        return;
      }
      if (!data.tienePiers) {
        setVerifSistema({ ...data, aviso: 'No se encontraron muros como Pier (Σ V2 = 0): se asume 0% de muros → Pórticos. Si hay muros, asígnales etiqueta de Pier en ETABS y reanaliza.' });
      } else {
        setVerifSistema(data);
      }
      setSisInput({
        pctX: data.fracX != null ? (data.fracX * 100).toFixed(1) : '',
        pctY: data.fracY != null ? (data.fracY * 100).toFixed(1) : '',
      });
      showStatus('success', `Cortante de muros leído — X: ${data.fracX != null ? (data.fracX * 100).toFixed(0) + '%' : '—'} · Y: ${data.fracY != null ? (data.fracY * 100).toFixed(0) + '%' : '—'}.`);
    } catch {
      setVerifSistema({ error: 'No se pudo conectar al servidor.' });
    }
  }, [config.pythonUrl, instanciaPid, espectroParams.casoX, espectroParams.casoY]);

  // Marca/desmarca una irregularidad en una direccion (campo iaX/iaY/ipX/ipY de disenoEspectro).
  const toggleIrregDir = (campo, id) => setDisenoEspectro(prev => {
    const arr = prev[campo] || [];
    return { ...prev, [campo]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
  });

  // Bloque de verificacion GEOMETRICA (compartido por geomVert / diafragma / noParalelo): un
  // solo boton lee la geometria y cada tarjeta muestra SU resultado de verifGeom.
  const geomVerifBlock = (tipo) => {
    const G = verifGeom;
    const btn = (
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleVerifGeom} disabled={G?.loading} className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50">{G?.loading ? 'Leyendo…' : '🔎 Verificar automáticamente (geometría)'}</button>
        <span className="text-[8.5px] text-slate-600">Lee la geometría del modelo (no necesita análisis).</span>
      </div>
    );
    let cuerpo = null;
    if (G?.error) {
      cuerpo = <p className="text-[9px] text-rose-300 mt-2 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">{G.error}</p>;
    } else if (G?.vertical && tipo === 'geomVert') {
      const dir = (lbl, o) => {
        const m = Math.max(0, ...o.filas.map(f => f.rel || 0));
        return (
          <div className="flex items-center justify-between gap-2 text-[9px] py-0.5">
            <span className="text-slate-400 font-black">Dirección {lbl}</span>
            <span className="tabular-nums text-slate-200">razón máx {m ? `${m.toFixed(2)}×` : '—'}</span>
            <span className={o.irregular ? 'text-amber-300 font-black' : 'text-emerald-400 font-black'}>{o.irregular ? 'IRREGULAR · Ia=0,90' : 'regular'}</span>
          </div>
        );
      };
      cuerpo = (
        <div className="mt-2">
          <div className="rounded-lg border border-white/10 p-2 space-y-0.5">{dir('X', G.vertical.x)}{dir('Y', G.vertical.y)}</div>
          <p className="text-[8px] text-slate-600 mt-1.5">Dimensión en planta del sistema resistente por piso (X/Y); irregular si &gt;1,3× el piso adyacente. La azotea se excluye. Marca automática; ajústala si discrepas.</p>
        </div>
      );
    } else if (G?.diafragma && tipo === 'diafragma') {
      const f = G.diafragma;
      cuerpo = (
        <div className="mt-2">
          <div className={`text-[9.5px] font-black mb-1.5 ${f.irregular ? 'text-rose-300' : 'text-emerald-300'}`}>{f.irregular ? '⚠ Abertura de diafragma > 50% en algún piso (Ip=0,85)' : '✓ Diafragmas sin aberturas > 50% (Ip=1,00)'}</div>
          {f.filas.length ? (
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-[9px] tabular-nums">
                <thead className="bg-white/5 text-slate-400"><tr><th className="text-left py-1 px-2 font-black">Piso</th><th className="text-right py-1 px-2 font-black">Losa (m²)</th><th className="text-right py-1 px-2 font-black">Bruta (m²)</th><th className="text-right py-1 px-2 font-black">Abertura</th><th className="text-left py-1 px-2 font-black">Estado</th></tr></thead>
                <tbody>
                  {f.filas.map((x, i) => (
                    <tr key={i} className={`border-t border-white/5 ${x.viola ? 'bg-rose-500/[0.08]' : ''}`}>
                      <td className="py-1 px-2 text-slate-300">N{x.nivel}</td>
                      <td className="py-1 px-2 text-right text-slate-200">{x.slab.toFixed(1)}</td>
                      <td className="py-1 px-2 text-right text-slate-400">{x.gross.toFixed(1)}</td>
                      <td className={`py-1 px-2 text-right ${x.viola ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{(x.abertura * 100).toFixed(0)}%</td>
                      <td className="py-1 px-2 text-[8.5px]">{x.viola ? <span className="text-rose-300 font-black">&gt;50% ⚠</span> : <span className="text-emerald-400">ok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-[8.5px] text-slate-500">No hay losas/diafragmas legibles para evaluar aberturas.</p>}
          <p className="text-[8px] text-slate-600 mt-1.5">Abertura = 1 − área de losa ÷ área bruta (rectángulo envolvente) por piso. El criterio de área neta &lt;25% (cuellos) no se automatiza.</p>
        </div>
      );
    } else if (G?.noParalelo && tipo === 'noParalelo') {
      const f = G.noParalelo;
      cuerpo = (
        <div className="mt-2">
          <div className={`text-[9.5px] font-black mb-1.5 ${f.irregular ? 'text-rose-300' : 'text-emerald-300'}`}>{f.irregular ? `⚠ ${f.inclin.length} elemento(s) no paralelo(s) ≥30° — Ip=0,90` : '✓ Elementos ~ortogonales (Ip=1,00)'}</div>
          {f.inclin.length ? (
            <div className="rounded-lg border border-white/10 overflow-hidden max-h-40 overflow-y-auto">
              <table className="w-full text-[9px] tabular-nums">
                <thead className="bg-white/5 text-slate-400"><tr><th className="text-left py-1 px-2 font-black">Elemento</th><th className="text-left py-1 px-2 font-black">Tipo</th><th className="text-right py-1 px-2 font-black">Desv. eje</th></tr></thead>
                <tbody>
                  {f.inclin.slice(0, 12).map((x, i) => (
                    <tr key={i} className="border-t border-white/5 bg-rose-500/[0.06]"><td className="py-1 px-2 text-slate-300">{x.name}</td><td className="py-1 px-2 text-slate-400">{x.tipo}</td><td className="py-1 px-2 text-right text-rose-300 font-black">{x.desv}°</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-[8px] text-slate-600 mt-1.5">Detecta muros/ejes con desviación ≥30° de los ejes principales. El criterio "resisten &gt;10% de la cortante" requiere análisis; confírmalo a mano.</p>
        </div>
      );
    } else if (G?.esquinas && tipo === 'esquinas') {
      const f = G.esquinas;
      const peores = f.filas.map(x => x.peor ? { nivel: x.nivel, ...x.peor } : null).filter(Boolean).sort((a, b) => (b.rx + b.ry) - (a.rx + a.ry));
      cuerpo = !f.evaluado ? <p className="text-[8.5px] text-slate-500 mt-2">No hay losas para evaluar la planta.</p> : (
        <div className="mt-2">
          <div className={`text-[9.5px] font-black mb-1.5 ${f.irregular ? 'text-rose-300' : 'text-emerald-300'}`}>{f.irregular ? '⚠ Esquina entrante > 20% en ambas direcciones (Ip=0,90)' : '✓ Sin esquinas entrantes > 20% (Ip=1,00)'}</div>
          {peores.length ? (
            <div className="rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-[9px] tabular-nums">
                <thead className="bg-white/5 text-slate-400"><tr><th className="text-left py-1 px-2 font-black">Piso</th><th className="text-left py-1 px-2 font-black">Esquina</th><th className="text-right py-1 px-2 font-black">a/Lx</th><th className="text-right py-1 px-2 font-black">b/Ly</th><th className="text-left py-1 px-2 font-black">Estado</th></tr></thead>
                <tbody>
                  {peores.slice(0, 6).map((x, i) => (
                    <tr key={i} className={`border-t border-white/5 ${x.viola ? 'bg-rose-500/[0.08]' : ''}`}>
                      <td className="py-1 px-2 text-slate-300">N{x.nivel}</td>
                      <td className="py-1 px-2 text-slate-400">{x.lbl}</td>
                      <td className={`py-1 px-2 text-right ${x.viola ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{(x.rx * 100).toFixed(0)}%</td>
                      <td className={`py-1 px-2 text-right ${x.viola ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{(x.ry * 100).toFixed(0)}%</td>
                      <td className="py-1 px-2 text-[8.5px]">{x.viola ? <span className="text-rose-300 font-black">&gt;20% ⚠</span> : <span className="text-emerald-400">ok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-[8.5px] text-slate-500">Planta rectangular: sin esquinas entrantes.</p>}
          <p className="text-[8px] text-slate-600 mt-1.5">Proyección del entrante en cada esquina del rectángulo envolvente (rejilla de losas). Irregular si supera 20% del lado EN AMBAS direcciones.</p>
        </div>
      );
    }
    return <div className="mt-2 pt-2 border-t border-white/5">{btn}{cuerpo}</div>;
  };

  // Tarjeta de UNA irregularidad: esquema + tabla/factor + umbral + criterio + checkboxes X/Y
  // (+ bloque de verificacion automatica para 'masa'). La reusan el panel general y el modal
  // individual de cada nodo del diagrama.
  const renderIrregCard = (it, cX, cY) => {
    const onX = (disenoEspectro[cX] || []).includes(it.id);
    const onY = (disenoEspectro[cY] || []).includes(it.id);
    const activo = onX || onY;
    return (
      <div key={it.id} className={`rounded-xl border p-3 flex gap-3 transition-colors ${activo ? 'border-rose-500/45 bg-rose-500/[0.06]' : 'border-white/10 bg-white/[0.02]'}`}>
        <div className="shrink-0"><EsquemaIrreg tipo={it.esquema} w={200} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-black text-slate-100 leading-tight">{it.nombre}</span>
            <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-slate-400 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">Tabla {it.tabla} · I={it.f.toFixed(2)}</span>
          </div>
          <div className="text-[9px] font-black text-amber-300/90 mb-1 tabular-nums">{it.umbral}</div>
          <p className="text-[9.5px] text-slate-400 leading-relaxed">{it.criterio}</p>
          <p className="text-[8.5px] text-slate-600 mt-1.5">📐 {it.como}</p>
          <div className="flex items-center gap-5 mt-2 pt-2 border-t border-white/5">
            <label className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide text-sky-300 cursor-pointer select-none"><input type="checkbox" checked={onX} onChange={() => toggleIrregDir(cX, it.id)} className="accent-sky-500 w-3.5 h-3.5 cursor-pointer" /> Existe en X</label>
            <label className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide text-rose-300 cursor-pointer select-none"><input type="checkbox" checked={onY} onChange={() => toggleIrregDir(cY, it.id)} className="accent-rose-500 w-3.5 h-3.5 cursor-pointer" /> Existe en Y</label>
          </div>
          {it.id === 'masa' && (
              <div className="mt-2 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={handleVerifMasa} disabled={verifMasa?.loading} className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50">{verifMasa?.loading ? 'Leyendo…' : '🔎 Verificar automáticamente (Mass Summary)'}</button>
                  <span className="text-[8.5px] text-slate-600">Lee el peso por piso del modelo analizado y aplica P &gt; 1,5·P_adyacente.</span>
                </div>
                {verifMasa?.error && <p className="text-[9px] text-rose-300 mt-2 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">{verifMasa.error}</p>}
                {verifMasa?.filas && (
                  <div className="mt-2">
                    <div className={`text-[9.5px] font-black mb-1.5 ${verifMasa.irregular ? 'text-rose-300' : 'text-emerald-300'}`}>{verifMasa.irregular ? '⚠ Irregularidad de masa DETECTADA (Ia = 0,90, marcada en X e Y)' : '✓ Sin irregularidad de masa (Ia = 1,00)'}</div>
                    <div className="rounded-lg border border-white/10 overflow-hidden">
                      <table className="w-full text-[9px] tabular-nums">
                        <thead className="bg-white/5 text-slate-400"><tr>
                          <th className="text-left py-1 px-2 font-black">Piso</th>
                          <th className="text-right py-1 px-2 font-black">Peso (t)</th>
                          <th className="text-right py-1 px-2 font-black">P / P_adyac.</th>
                          <th className="text-left py-1 px-2 font-black">Estado</th>
                        </tr></thead>
                        <tbody>
                          {verifMasa.filas.map((f, i) => (
                            <tr key={i} className={`border-t border-white/5 ${f.viola ? 'bg-rose-500/[0.08]' : ''}`}>
                              <td className="py-1 px-2 text-slate-300">{f.piso}</td>
                              <td className="py-1 px-2 text-right text-slate-200">{f.masa.toFixed(2)}</td>
                              <td className={`py-1 px-2 text-right ${f.viola ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{f.rel ? `${f.rel.toFixed(2)}×` : '—'}</td>
                              <td className="py-1 px-2 text-[8.5px]">{f.exenta ? <span className="text-slate-500">exento ({f.motivo})</span> : f.viola ? <span className="text-rose-300 font-black">&gt; 1,5 ⚠</span> : <span className="text-emerald-400">ok</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[8px] text-slate-600 mt-1.5">Azotea y sótanos se excluyen del criterio (E.030). Peso por piso de «Mass Summary by Story» (tonne). Puedes ajustar el check manualmente si discrepas.</p>
                  </div>
                )}
              </div>
            )}
          {(it.id === 'torsion' || it.id === 'torsionExt') && (
            <div className="mt-2 pt-2 border-t border-white/5">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleVerifTorsion} disabled={verifTorsion?.loading} className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50">{verifTorsion?.loading ? 'Leyendo…' : '🔎 Verificar automáticamente (Story Max/Avg Drifts)'}</button>
                <span className="text-[8.5px] text-slate-600">Razón Δmax/Δprom por piso (ETABS), por dirección X e Y.</span>
              </div>
              {verifTorsion?.error && <p className="text-[9px] text-rose-300 mt-2 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">{verifTorsion.error}</p>}
              {verifTorsion?.res && (() => {
                const R = verifTorsion.res;
                const verd = o => o.tipo === 'torsionExt' ? <span className="text-rose-300 font-black">TORSIONAL EXTREMA · Ip=0,60</span> : o.tipo === 'torsion' ? <span className="text-amber-300 font-black">Torsional · Ip=0,75</span> : <span className="text-emerald-400 font-black">regular</span>;
                const linea = (lbl, o) => (
                  <div className="flex items-center justify-between gap-2 text-[9px] py-0.5">
                    <span className="text-slate-400 font-black">Dirección {lbl}</span>
                    <span className="tabular-nums text-slate-200">razón máx {o.ratioMax ? `${o.ratioMax.toFixed(2)}×` : '—'}{o.peor ? ` (${o.peor.piso})` : ''}</span>
                    <span>{verd(o)}</span>
                  </div>
                );
                const filas = [...R.x.filas.map(f => ({ ...f, d: 'X' })), ...R.y.filas.map(f => ({ ...f, d: 'Y' }))]
                  .filter(f => !f.exenta).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
                return (
                  <div className="mt-2">
                    <div className="rounded-lg border border-white/10 p-2 mb-2 space-y-0.5">{linea('X', R.x)}{linea('Y', R.y)}</div>
                    {filas.length > 0 ? (
                      <div className="rounded-lg border border-white/10 overflow-hidden">
                        <table className="w-full text-[9px] tabular-nums">
                          <thead className="bg-white/5 text-slate-400"><tr>
                            <th className="text-left py-1 px-2 font-black">Piso</th>
                            <th className="text-left py-1 px-2 font-black">Caso</th>
                            <th className="text-center py-1 px-2 font-black">Dir</th>
                            <th className="text-right py-1 px-2 font-black">Δmax/Δprom</th>
                            <th className="text-left py-1 px-2 font-black">Estado</th>
                          </tr></thead>
                          <tbody>
                            {filas.map((f, i) => {
                              const viol = f.ratio > 1.5 ? 'ext' : f.ratio > 1.3 ? 'tor' : '';
                              return (
                                <tr key={i} className={`border-t border-white/5 ${viol ? 'bg-rose-500/[0.08]' : ''}`}>
                                  <td className="py-1 px-2 text-slate-300">{f.piso}</td>
                                  <td className="py-1 px-2 text-slate-400 truncate max-w-[84px]" title={f.caso}>{f.caso}</td>
                                  <td className="py-1 px-2 text-center text-slate-400">{f.d}</td>
                                  <td className={`py-1 px-2 text-right ${viol ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{f.ratio.toFixed(2)}×</td>
                                  <td className="py-1 px-2 text-[8.5px]">{viol === 'ext' ? <span className="text-rose-300 font-black">&gt;1,5 ⚠</span> : viol === 'tor' ? <span className="text-amber-300 font-black">&gt;1,3 ⚠</span> : <span className="text-emerald-400">ok</span>}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-[8.5px] text-slate-500">Ningún piso supera el 50% de la deriva permisible: el criterio torsional no aplica (Ip = 1,00).</p>}
                    <p className="text-[8px] text-slate-600 mt-1.5">Solo se evalúan pisos con Δmax &gt; 50% del permisible (E.030). Razón de «Story Max Over Avg Drifts»; requiere diafragmas rígidos. El marcado X/Y es automático; puedes ajustarlo a mano.</p>
                  </div>
                );
              })()}
            </div>
          )}
          {(it.id === 'rigidez' || it.id === 'rigidezExt') && (
            <div className="mt-2 pt-2 border-t border-white/5">
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleVerifRigidez} disabled={verifRigidez?.loading} className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50">{verifRigidez?.loading ? 'Leyendo…' : '🔎 Verificar automáticamente (Story Stiffness)'}</button>
                <span className="text-[8.5px] text-slate-600">Rigidez de entrepiso K=V/Δ por piso, vs el superior y el promedio de 3.</span>
              </div>
              {verifRigidez?.error && <p className="text-[9px] text-rose-300 mt-2 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">{verifRigidez.error}</p>}
              {verifRigidez?.res && (() => {
                const R = verifRigidez.res;
                const verd = o => o.tipo === 'rigidezExt' ? <span className="text-rose-300 font-black">EXTREMA · Ia=0,50</span> : o.tipo === 'rigidez' ? <span className="text-amber-300 font-black">PISO BLANDO · Ia=0,75</span> : <span className="text-emerald-400 font-black">regular</span>;
                const linea = (lbl, o) => (
                  <div className="flex items-center justify-between gap-2 text-[9px] py-0.5">
                    <span className="text-slate-400 font-black">Dirección {lbl}</span>
                    <span className="tabular-nums text-slate-200">{o.peor ? `K/K_sup mín ${(o.peor.rel ?? 0).toFixed(2)} (${o.peor.piso})` : 'sin piso crítico'}</span>
                    <span>{verd(o)}</span>
                  </div>
                );
                const filas = [...R.x.filas.filter(f => !f.exenta).map(f => ({ ...f, d: 'X' })), ...R.y.filas.filter(f => !f.exenta).map(f => ({ ...f, d: 'Y' }))]
                  .sort((a, b) => (a.rel ?? 9) - (b.rel ?? 9)).slice(0, 8);
                return (
                  <div className="mt-2">
                    <div className="rounded-lg border border-white/10 p-2 mb-2 space-y-0.5">{linea('X', R.x)}{linea('Y', R.y)}</div>
                    {filas.length > 0 ? (
                      <div className="rounded-lg border border-white/10 overflow-hidden">
                        <table className="w-full text-[9px] tabular-nums">
                          <thead className="bg-white/5 text-slate-400"><tr>
                            <th className="text-left py-1 px-2 font-black">Piso</th>
                            <th className="text-center py-1 px-2 font-black">Dir</th>
                            <th className="text-right py-1 px-2 font-black">K/K_sup</th>
                            <th className="text-right py-1 px-2 font-black">K/prom3</th>
                            <th className="text-left py-1 px-2 font-black">Estado</th>
                          </tr></thead>
                          <tbody>
                            {filas.map((f, i) => (
                              <tr key={i} className={`border-t border-white/5 ${f.tipo ? 'bg-rose-500/[0.08]' : ''}`}>
                                <td className="py-1 px-2 text-slate-300">{f.piso}</td>
                                <td className="py-1 px-2 text-center text-slate-400">{f.d}</td>
                                <td className={`py-1 px-2 text-right ${f.tipo ? 'text-rose-300 font-black' : 'text-slate-400'}`}>{f.rel != null ? f.rel.toFixed(2) : '—'}</td>
                                <td className="py-1 px-2 text-right text-slate-400">{f.relProm != null ? f.relProm.toFixed(2) : '—'}</td>
                                <td className="py-1 px-2 text-[8.5px]">{f.tipo === 'rigidezExt' ? <span className="text-rose-300 font-black">extrema ⚠</span> : f.tipo === 'rigidez' ? <span className="text-amber-300 font-black">blando ⚠</span> : <span className="text-emerald-400">ok</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-[8.5px] text-slate-500">No hay entrepisos evaluables (se necesita más de un piso con rigidez).</p>}
                    <p className="text-[8px] text-slate-600 mt-1.5">Rigidez K = V/Δ de «Story Stiffness». Piso blando: K&lt;0,70·K_sup o &lt;0,80·prom3; extrema: K&lt;0,60 o &lt;0,70. El piso tope no se evalúa. Marca X/Y automática; ajústala a mano si discrepas.</p>
                  </div>
                );
              })()}
            </div>
          )}
          {(it.id === 'geomVert' || it.id === 'diafragma' || it.id === 'noParalelo' || it.id === 'esquinas') && geomVerifBlock(it.id)}
          </div>
        </div>
      );
  };

  // Panel GENERAL del paso verifirreg: resumen R + las 13 tarjetas (altura y planta).
  const formVerifIrreg = (() => {
    const d = calcEspectroDiseno(disenoEspectro);
    const dato = (k, v, col = 'text-cyan-200') => (
      <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5">
        <div className="text-[8px] text-slate-500 font-black uppercase tracking-wide">{k}</div>
        <div className={`text-[12px] font-black tabular-nums ${col}`}>{v}</div>
      </div>
    );
    const tit = (t, sub) => (
      <div className="flex items-center justify-between mt-4 mb-2">
        <h4 className="text-[11px] font-black text-cyan-300 uppercase tracking-widest">{t}</h4>
        <span className="text-[8.5px] text-slate-500 font-bold">{sub}</span>
      </div>
    );
    return (
      <div>
        <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Tras el 1er análisis se revisan las <b className="text-cyan-300">irregularidades de la E.030</b> en altura (Ia) y planta (Ip). El coeficiente de reducción se afecta con <b className="text-slate-300">R = R₀·Ia·Ip</b> por dirección, donde <b>Ia/Ip = el MÍNIMO factor de las irregularidades presentes</b> (1,00 si ninguna). Marca abajo las que apliquen en cada dirección: es la <b className="text-amber-300/90">misma fuente</b> que la pestaña «El Espectro de Diseño», así que R se actualiza en todo el flujo.</p>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 mb-2">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Resultado actual (por dirección)</div>
          <div className="grid grid-cols-6 gap-1.5">
            {dato('Ia · X', d.Iax.toFixed(2))}{dato('Ip · X', d.Ipx.toFixed(2))}{dato('R · X', d.valido ? d.Rx.toFixed(2) : '—', 'text-sky-300')}
            {dato('Ia · Y', d.Iay.toFixed(2))}{dato('Ip · Y', d.Ipy.toFixed(2))}{dato('R · Y', d.valido ? d.Ry.toFixed(2) : '—', 'text-rose-300')}
          </div>
          <p className="text-[8.5px] text-slate-600 mt-2">R₀ X = {d.R0x} ({d.sisX.nombre}) · R₀ Y = {d.R0y} ({d.sisY.nombre}). Estructura {(d.Iax < 1 || d.Iay < 1 || d.Ipx < 1 || d.Ipy < 1) ? <b className="text-rose-300">IRREGULAR</b> : <b className="text-emerald-300">regular</b>} según lo marcado.</p>
        </div>

        {tit('Irregularidades en altura (Ia) · Tabla N°11', `${IRREG_ALTURA.length} tipos`)}
        <div className="space-y-2">{IRREG_ALTURA.map(it => renderIrregCard(it, 'iaX', 'iaY'))}</div>

        {tit('Irregularidades en planta (Ip) · Tabla N°12', `${IRREG_PLANTA.length} tipos`)}
        <div className="space-y-2">{IRREG_PLANTA.map(it => renderIrregCard(it, 'ipX', 'ipY'))}</div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-white/10">
          <p className="text-[8.5px] text-slate-500 leading-relaxed flex-1">Ya se <b className="text-amber-300/90">verifican automáticamente</b>: <b className="text-emerald-300">Masa</b>, <b className="text-emerald-300">Torsional</b>, <b className="text-emerald-300">Piso blando (rigidez)</b>, <b className="text-emerald-300">Geométrica vertical</b>, <b className="text-emerald-300">Diafragma</b>, <b className="text-emerald-300">Sistemas no paralelos</b> y <b className="text-emerald-300">Esquinas entrantes</b> (botón en su tarjeta). Quedan manuales <b className="text-slate-300">Resistencia/piso débil</b> y <b className="text-slate-300">Discontinuidad de sistemas resistentes</b> (necesitan capacidad de diseño / fracción de cortante).</p>
          <button onClick={() => { marcarPaso('verifirreg'); setOpenStep(''); showStatus('success', `Irregularidades revisadas · R-X=${d.valido ? d.Rx.toFixed(2) : '—'} R-Y=${d.valido ? d.Ry.toFixed(2) : '—'}.`); }} className="shrink-0 bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase text-white flex items-center gap-2 transition-colors"><Play size={13} /> Marcar revisada</button>
        </div>
      </div>
    );
  })();

  // VERIFICAR SISTEMA ESTRUCTURAL (E.030 Tabla N°8): clasifica por el % del cortante basal que
  // toman los muros (auto desde el modelo o a mano) -> Pórticos / Dual / Muros / EMDL -> fija R0.
  const formVerifSistema = (() => {
    const setSis = (campo, valor) => setDisenoEspectro(prev => ({ ...prev, [campo]: valor }));
    const setPct = (campo, valor) => setSisInput(prev => ({ ...prev, [campo]: valor }));
    const frac = v => (v !== '' && v != null && !isNaN(Number(v))) ? Number(v) / 100 : null;
    const fracX = frac(sisInput.pctX), fracY = frac(sisInput.pctY);
    const clasX = clasificarSistemaMuros(fracX), clasY = clasificarSistemaMuros(fracY);
    const sysById = id => SISTEMAS_TABLA8.find(s => s.id === id);
    const sisActual = id => SISTEMAS_E030.find(s => s.id === id);
    const VS = verifSistema;
    const aplicar = (campo, clasId) => { const t = sysById(clasId); if (t) { setSis(campo, t.sis); showStatus('success', `${campo === 'sistemaX' ? 'Dirección X' : 'Dirección Y'} → ${t.nombre} (R₀ = ${t.r0}).`); } };
    const card8 = (it) => {
      const activo = it.id === clasX || it.id === clasY;
      return (
        <div key={it.id} className={`rounded-lg border p-2.5 transition-colors ${activo ? 'border-cyan-400/55 bg-cyan-500/[0.07]' : 'border-white/10 bg-white/[0.02]'}`}>
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-[10.5px] font-black text-slate-100">{it.nombre}</span>
            <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-cyan-200 bg-cyan-500/10 border border-cyan-500/25 rounded px-1.5 py-0.5">R₀ = {it.r0}</span>
          </div>
          <div className="text-[8.5px] font-black text-amber-300/90 mb-1 tabular-nums">{it.rango}</div>
          <p className="text-[9px] text-slate-400 leading-relaxed">{it.criterio}</p>
          {activo && <div className="text-[8px] font-black uppercase tracking-wider text-cyan-300 mt-1">{it.id === clasX ? '◀ resulta en X' : ''} {it.id === clasY ? '◀ resulta en Y' : ''}</div>}
        </div>
      );
    };
    const dirBlock = (lbl, campo, pctKey, fracDir, clasId, sisDir) => {
      const t = sysById(clasId);
      const act = sisActual(sisDir);
      const coincide = t && act && t.sis === sisDir;
      return (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black text-slate-200 uppercase tracking-wide">Dirección {lbl}</span>
            <span className="text-[8.5px] text-slate-500">declarado: <b className="text-slate-300">{act ? act.nombre : '—'}</b> (R₀={act ? act.r0 : '—'})</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[9px] text-slate-400 font-bold">% cortante en muros</label>
            <input type="number" step="1" min="0" max="100" value={sisInput[pctKey]} onChange={e => setPct(pctKey, e.target.value)} placeholder="—" className="w-20 bg-black/30 border border-white/10 px-2 py-1 rounded text-[11px] text-slate-100 font-mono text-right outline-none focus:border-cyan-400/60" />
            <span className="text-[9px] text-slate-500">%</span>
          </div>
          {t ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[9.5px]">→ <b className={coincide ? 'text-emerald-300' : 'text-amber-300'}>{t.nombre}</b> · R₀ = {t.r0} {coincide ? <span className="text-emerald-400 font-black">✓ coincide</span> : <span className="text-amber-400 font-black">⚠ difiere del declarado</span>}</div>
              <button onClick={() => aplicar(campo, clasId)} className="shrink-0 bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-2.5 py-1 rounded-lg text-[8.5px] font-black uppercase tracking-wide transition-colors">Aplicar a {lbl}</button>
            </div>
          ) : <div className="text-[9px] text-slate-500">Ingresa el % (o usa «Leer del modelo») para clasificar.</div>}
        </div>
      );
    };
    return (
      <div>
        <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">El sistema estructural (E.030 <b className="text-cyan-300">Tabla N°8</b>) se define por el <b className="text-slate-300">% de la fuerza cortante en la base que toman los muros</b>, por dirección. Fija el <b className="text-slate-300">R₀</b> del espectro: Pórticos R₀=8 · Dual R₀=7 · Muros R₀=6 · EMDL R₀=3,5.</p>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 mb-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Cortante en muros (del modelo)</div>
            <button onClick={handleVerifSistema} disabled={VS?.loading} className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-200 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50">{VS?.loading ? 'Leyendo…' : '🔎 Leer del modelo (Pier Forces)'}</button>
          </div>
          {VS?.error && <p className="text-[9px] text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">{VS.error}</p>}
          {VS?.aviso && <p className="text-[9px] text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5 mb-2">{VS.aviso}</p>}
          {VS && VS.vTotalX != null && !VS.error && (
            <div className="grid grid-cols-4 gap-1.5 text-[9px]">
              <div className="bg-black/30 rounded px-2 py-1 border border-white/5"><div className="text-[8px] text-slate-500 font-black uppercase">V base X (tonf)</div><div className="text-slate-200 font-black tabular-nums">{(VS.vTotalX / 1000).toFixed(1)}</div></div>
              <div className="bg-black/30 rounded px-2 py-1 border border-white/5"><div className="text-[8px] text-slate-500 font-black uppercase">V muros X</div><div className="text-sky-300 font-black tabular-nums">{(VS.vMurosX / 1000).toFixed(1)}</div></div>
              <div className="bg-black/30 rounded px-2 py-1 border border-white/5"><div className="text-[8px] text-slate-500 font-black uppercase">V base Y (tonf)</div><div className="text-slate-200 font-black tabular-nums">{(VS.vTotalY / 1000).toFixed(1)}</div></div>
              <div className="bg-black/30 rounded px-2 py-1 border border-white/5"><div className="text-[8px] text-slate-500 font-black uppercase">V muros Y</div><div className="text-rose-300 font-black tabular-nums">{(VS.vMurosY / 1000).toFixed(1)}</div></div>
            </div>
          )}
          <p className="text-[8px] text-slate-600 mt-2">Σ |V2| (cortante en el plano) de los muros-Pier en el piso base ÷ cortante basal. Requiere modelo analizado y muros como Pier. También puedes escribir el % a mano abajo.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          {dirBlock('X', 'sistemaX', 'pctX', fracX, clasX, disenoEspectro.sistemaX)}
          {dirBlock('Y', 'sistemaY', 'pctY', fracY, clasY, disenoEspectro.sistemaY)}
        </div>

        <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-1.5">Tabla N°8 · Sistemas de concreto armado</div>
        <div className="grid grid-cols-2 gap-2">{SISTEMAS_TABLA8.map(card8)}</div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-white/10">
          <p className="text-[8.5px] text-slate-500 leading-relaxed flex-1"><b className="text-amber-300/90">EMDL</b> no se deduce solo del cortante (depende de la densidad de muros &gt; 2,5% y máx. 5 pisos): elígelo a mano si aplica. Aplicar el sistema actualiza <b className="text-slate-300">R₀</b> y por tanto R = R₀·Ia·Ip en todo el flujo.</p>
          <button onClick={() => { marcarPaso('verifsistema'); setOpenStep(''); showStatus('success', 'Sistema estructural revisado.'); }} className="shrink-0 bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase text-white flex items-center gap-2 transition-colors"><Play size={13} /> Marcar revisada</button>
        </div>
      </div>
    );
  })();

  const formCombos = (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={comboParams.incluirCE} onChange={e => setCombo('incluirCE', e.target.checked)} />Incluir CE</label>
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={comboParams.incluirSismo} onChange={e => setCombo('incluirSismo', e.target.checked)} />Incluir sismo</label>
      </div>
      {comboParams.incluirSismo && (
        <div className="grid grid-cols-4 gap-3">
          <div><label className={lblCls}>Caso sismo X</label><input value={comboParams.casoSismoX} onChange={e => setCombo('casoSismoX', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Caso sismo Y</label><input value={comboParams.casoSismoY} onChange={e => setCombo('casoSismoY', e.target.value)} className={inputCls} /></div>
          <div><label className={lblCls}>Factor deriva X (auto)</label><input type="number" value={comboParams.factorDerivaX} readOnly title="Calculado desde El Espectro de Diseño" className={`${inputCls} opacity-80 cursor-not-allowed`} /></div>
          <div><label className={lblCls}>Factor deriva Y (auto)</label><input type="number" value={comboParams.factorDerivaY} readOnly title="Calculado desde El Espectro de Diseño" className={`${inputCls} opacity-80 cursor-not-allowed`} /></div>
        </div>
      )}
      {comboParams.incluirSismo && (() => {
        const dd = calcEspectroDiseno(disenoEspectro);
        const irr = dd.Iax < 1 || dd.Iay < 1 || dd.Ipx < 1 || dd.Ipy < 1;
        const fac = irr ? 0.85 : 0.75;
        return (
          <p className="text-[9px] mt-2 text-emerald-400/90">
            ⚙️ AUTOMÁTICO desde <b>El Espectro de Diseño</b>: factor de deriva = <b>{irr ? '0.85·R' : '0.75·R'}</b> (estructura {irr ? 'IRREGULAR' : 'REGULAR'} según Ia/Ip), con <b>R = R₀·Ia·Ip</b> por dirección → <b>DERVX = {fac}·{dd.Rx.toFixed(2)} = {(fac * dd.Rx).toFixed(3)}</b> · <b>DERVY = {fac}·{dd.Ry.toFixed(2)} = {(fac * dd.Ry).toFixed(3)}</b>. Cambia las irregularidades o el sistema en esa pestaña y esto se recalcula solo.
          </p>
        );
      })()}
    </div>
  );

  const formLosaMaciza = (
    <div className="grid grid-cols-3 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={losaMacizaParams.nombre} onChange={e => setLosaM('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={losaMacizaParams.material} onChange={e => setLosaM('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Espesor h (cm)</label><input type="number" step="2.5" value={losaMacizaParams.espesorCm} onChange={e => setLosaM('espesorCm', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formLosa1d = (
    <div className="grid grid-cols-2 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={losa1dParams.nombre} onChange={e => setLosa1('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={losa1dParams.material} onChange={e => setLosa1('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Peralte total h (cm)</label><input type="number" step="2.5" value={losa1dParams.peralteCm} onChange={e => setLosa1('peralteCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Losita superior (cm)</label><input type="number" step="0.5" value={losa1dParams.losaCm} onChange={e => setLosa1('losaCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Vigueta arriba (cm)</label><input type="number" step="1" value={losa1dParams.viguetaSupCm} onChange={e => setLosa1('viguetaSupCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Vigueta abajo (cm)</label><input type="number" step="1" value={losa1dParams.viguetaInfCm} onChange={e => setLosa1('viguetaInfCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Separacion @ (cm)</label><input type="number" step="5" value={losa1dParams.separacionCm} onChange={e => setLosa1('separacionCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Viguetas paralelas a eje</label>
        <select value={losa1dParams.paralelo} onChange={e => setLosa1('paralelo', e.target.value)} className={inputCls}>
          <option value={1}>Eje local 1</option>
          <option value={2}>Eje local 2</option>
        </select>
      </div>
    </div>
  );

  const formLosa2d = (
    <div className="grid grid-cols-2 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={losa2dParams.nombre} onChange={e => setLosa2('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={losa2dParams.material} onChange={e => setLosa2('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Peralte total h (cm)</label><input type="number" step="2.5" value={losa2dParams.peralteCm} onChange={e => setLosa2('peralteCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Losita superior (cm)</label><input type="number" step="0.5" value={losa2dParams.losaCm} onChange={e => setLosa2('losaCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Nervio arriba (cm)</label><input type="number" step="1" value={losa2dParams.nervioSupCm} onChange={e => setLosa2('nervioSupCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Nervio abajo (cm)</label><input type="number" step="1" value={losa2dParams.nervioInfCm} onChange={e => setLosa2('nervioInfCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Separacion X (cm)</label><input type="number" step="5" value={losa2dParams.separacionXCm} onChange={e => setLosa2('separacionXCm', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Separacion Y (cm)</label><input type="number" step="5" value={losa2dParams.separacionYCm} onChange={e => setLosa2('separacionYCm', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formDrawSlab = (
    <div>
      <div><label className={lblCls}>Seccion de losa (debe existir)</label><input value={drawSlabParams.seccionLosa} onChange={e => setDrawSlab('seccionLosa', e.target.value)} className={inputCls} /></div>
      <p className="text-[9px] text-slate-500 mt-2">Dibuja un pano por cada celda de la grilla en cada nivel de piso (lee la grilla y los pisos del modelo abierto).</p>
    </div>
  );

  const formDrawSlabInfo = (tipo) => {
    const n = tipo === 'losa1d' ? losa1dParams.nombre : tipo === 'losa2d' ? losa2dParams.nombre : losaMacizaParams.nombre;
    return (
      <div>
        <p className="text-[10px] text-slate-300">Dibujara la losa <span className="font-bold text-cyan-300">{n}</span> en cada pano de la grilla, en todos los niveles.</p>
        <p className="text-[9px] text-slate-500 mt-1">La losa debe estar definida primero. Se verifica por conteo de panos.</p>
      </div>
    );
  };

  const formBeamLoads = (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div><label className={lblCls}>Carga CM (kgf/m)</label><input type="number" step="10" value={beamLoadParams.cargaCM} onChange={e => setBeamLoad('cargaCM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Carga CV (kgf/m, 0=no)</label><input type="number" step="10" value={beamLoadParams.cargaCV} onChange={e => setBeamLoad('cargaCV', e.target.value)} className={inputCls} /></div>
        <div className="col-span-2"><label className={lblCls}>Solo seccion (vacio = todas las vigas)</label><input value={beamLoadParams.filtroSeccion} onChange={e => setBeamLoad('filtroSeccion', e.target.value)} placeholder="Ej: V30X60" className={inputCls} /></div>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={beamLoadParams.reemplazar} onChange={e => setBeamLoad('reemplazar', e.target.checked)} />Reemplazar carga previa del patron (recomendado)</label>
      <p className="text-[9px] text-slate-500 mt-2">Detecta las vigas (frames horizontales) y les asigna carga uniforme en direccion de gravedad. Tu modelo de clase usa 280 kgf/m en CM (tabiqueria).</p>
    </div>
  );

  const formSlabLoads = (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div><label className={lblCls}>Carga CM (kgf/m2)</label><input type="number" step="10" value={slabLoadParams.cargaCM} onChange={e => setSlabLoad('cargaCM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Carga CV (kgf/m2, 0=no)</label><input type="number" step="10" value={slabLoadParams.cargaCV} onChange={e => setSlabLoad('cargaCV', e.target.value)} className={inputCls} /></div>
        <div className="col-span-2"><label className={lblCls}>Solo propiedad (vacio = todas las losas)</label><input value={slabLoadParams.filtroPropiedad} onChange={e => setSlabLoad('filtroPropiedad', e.target.value)} placeholder="Ej: LA1D_H25" className={inputCls} /></div>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={slabLoadParams.reemplazar} onChange={e => setSlabLoad('reemplazar', e.target.checked)} />Reemplazar carga previa del patron (recomendado)</label>
      <p className="text-[9px] text-slate-500 mt-2">Asigna carga uniforme en gravedad a las losas dibujadas. Tu modelo de clase usa CM=300 / CV=250 kgf/m2 en pisos tipicos (azotea: 200/100).</p>
    </div>
  );

  const formEspectro = (
    <div>
      <p className="text-[9px] text-emerald-400/90 mb-2 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">🔗 Z, U, S, TP, TL, R y los factores de escala se toman AUTOMÁTICAMENTE de la pestaña <b>📈 El Espectro de Diseño</b> (R = R₀·Ia·Ip por dirección; el espectro Y se obtiene del X con SF = Rx/Ry). Edítalos allí. Aquí solo defines la función/casos/masa.</p>
      <div className="grid grid-cols-3 gap-3 mb-2">
        <div><label className={lblCls}>Nombre funcion</label><input value={espectroParams.nombreFuncion} onChange={e => setEspectro('nombreFuncion', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Z (del espectro)</label><input type="number" value={espectroParams.z} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>U (del espectro)</label><input type="number" value={espectroParams.u} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>S (del espectro)</label><input type="number" value={espectroParams.s} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>TP (del espectro)</label><input type="number" value={espectroParams.tp} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>TL (del espectro)</label><input type="number" value={espectroParams.tl} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>R = R₀·Ia·Ip (X)</label><input type="number" value={espectroParams.r} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div><label className={lblCls}>Masa: factor CM</label><input type="number" step="0.05" value={espectroParams.masaCM} onChange={e => setEspectro('masaCM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Masa: factor CV</label><input type="number" step="0.05" value={espectroParams.masaCV} onChange={e => setEspectro('masaCV', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Caso modal (Ritz)</label><input value={espectroParams.casoModal} onChange={e => setEspectro('casoModal', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Modos min</label><input type="number" min="1" value={espectroParams.modosMin} onChange={e => setEspectro('modosMin', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Modos max</label><input type="number" min="1" value={espectroParams.modosMax} onChange={e => setEspectro('modosMax', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Caso sismo X</label><input value={espectroParams.casoX} onChange={e => setEspectro('casoX', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>SF X (auto)</label><input type="number" value={espectroParams.sfX} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
        <div></div>
        <div><label className={lblCls}>Caso sismo Y</label><input value={espectroParams.casoY} onChange={e => setEspectro('casoY', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>SF Y = Rx/Ry (auto)</label><input type="number" value={espectroParams.sfY} readOnly className={`${inputCls} opacity-70 cursor-not-allowed`} /></div>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={espectroParams.orto30} onChange={e => setEspectro('orto30', e.target.checked)} />Incluir 30% en la direccion ortogonal (E.030)</label>
      <p className="text-[9px] text-slate-500 mt-2">Crea la funcion del espectro Sa = Z·U·C·S/R·g (m/s2) con C de la E.030, el caso modal Ritz, la masa sismica (100%CM + %CV) y los casos CSX/CSY. El espectro en Y sale del de X con el factor de escala SF = Rx/Ry (R distinto por direccion). El amortiguamiento es 5% (fijo de ETABS).</p>
    </div>
  );

  // ----- VISTA PREVIA: geometria calculada desde los formularios -----
  // Grilla del modelo REAL: geometria leida en el Modelador, o Diagnosticar, o Contrastar.
  const gridReal = modeloGeo || diagData || vistaResumen;
  const usandoReal = fuenteGrilla === 'real' && gridReal && (gridReal.grilla_x || []).length >= 2;
  const ordsPreview = usandoReal
    ? { x: [...(gridReal.grilla_x || [])], y: [...(gridReal.grilla_y || [])] }
    : fuenteGrilla === 'noUniforme'
      ? { x: parseListaNumeros(nuGridParams.ordenadasX), y: parseListaNumeros(nuGridParams.ordenadasY) }
      : { x: ordenadasDeLuces(gridParams.espaciamientosX), y: ordenadasDeLuces(gridParams.espaciamientosY) };
  const nivelesPreview = (() => {
    if (usandoReal) {
      const base = Number(gridReal.base_z ?? 0);
      const elevs = (gridReal.elevaciones || []).map(Number);
      return Array.from(new Set([base, ...elevs])).sort((a, b) => a - b);
    }
    if (fuenteGrilla === 'noUniforme') {
      const n = Math.max(1, Math.round(Number(nuGridParams.numeroPisos) || 1));
      const h = Number(nuGridParams.alturaPiso) || 3;
      return Array.from({ length: n + 1 }, (_, i) => i * h);
    }
    const alturas = parseAlturasPisos(gridParams.alturasPisos);
    return nivelesDeAlturas(alturas.length ? alturas : [3]);
  })();
  const etiquetaCargaLosa = `CM=${slabLoadParams.cargaCM || 0}${Number(slabLoadParams.cargaCV) ? ` / CV=${slabLoadParams.cargaCV}` : ''} kgf/m²`;
  const etiquetaCargaViga = `CM=${beamLoadParams.cargaCM || 0}${Number(beamLoadParams.cargaCV) ? ` / CV=${beamLoadParams.cargaCV}` : ''} kgf/m`;

  // Resumen legible de CADA paso (lo que se creara con los valores actuales).
  const resumenPorPaso = {
    grid: fuenteGrilla === 'noUniforme'
      ? `Ordenadas X: ${nuGridParams.ordenadasX} | Y: ${nuGridParams.ordenadasY} · ${nuGridParams.numeroPisos} piso(s) de ${nuGridParams.alturaPiso} m`
      : `${ordsPreview.x.length}×${ordsPreview.y.length} ejes · luces X [${gridParams.espaciamientosX}] × Y [${gridParams.espaciamientosY}] m · ${altsGrid.length} pisos · alturas [${altsGrid.join(', ')}] m${ejesIncPreview.length ? ` · ${ejesIncPreview.length} eje(s) inclinado(s)` : ''}`,
    material: `${matParams.nombre}: f'c=${matParams.fc} kg/cm², peso ${matParams.peso} kgf/m³, E=15000√f'c (kgf-cm)`,
    acero: `${aceroParams.nombre}: Fy=${aceroParams.fy} kg/cm², Fu=${aceroParams.fu} kg/cm² (material de refuerzo)`,
    viga: `${vigaParams.nombre}: ${vigaParams.baseCm}×${vigaParams.alturaCm} cm, ${vigaParams.material}, recub. ${vigaParams.recubCm} cm (M3 Design)`,
    columna: `${colParams.nombre}: ${colParams.baseCm}×${colParams.alturaCm} cm, ${colParams.barras3}×${colParams.barras2} barras Ø${colParams.barraLong} mm, estribo Ø${colParams.barraEstribo} @ ${colParams.espEstriboCm} cm`,
    losa1d: `${losa1dParams.nombre}: h=${losa1dParams.peralteCm}, losita ${losa1dParams.losaCm}, vigueta ${losa1dParams.viguetaSupCm}/${losa1dParams.viguetaInfCm} @ ${losa1dParams.separacionCm} cm (${losa1dParams.material})`,
    losa2d: `${losa2dParams.nombre}: h=${losa2dParams.peralteCm}, losita ${losa2dParams.losaCm}, nervios ${losa2dParams.nervioSupCm}/${losa2dParams.nervioInfCm} @ ${losa2dParams.separacionXCm}×${losa2dParams.separacionYCm} cm`,
    losamaciza: `${losaMacizaParams.nombre}: espesor ${losaMacizaParams.espesorCm} cm (${losaMacizaParams.material})`,
    muro: `${muroDefParams.nombre}: e=${muroDefParams.espesorCm} cm, ${muroDefParams.material} (placa / muro de corte)`,
    dibviga: `Vigas ${drawParams.seccionViga}${drawParams.vigasX ? ' en X' : ''}${drawParams.vigasY ? ' y en Y' : ''}, en cada nivel`,
    dibcolumna: `Columnas ${drawParams.seccionColumna} en cada interseccion de ejes, todos los pisos`,
    diblosa1d: `Pano ${losa1dParams.nombre} por celda de grilla en cada nivel`,
    diblosa2d: `Pano ${losa2dParams.nombre} por celda de grilla en cada nivel`,
    diblosamaciza: `Pano ${losaMacizaParams.nombre} por celda de grilla en cada nivel`,
    dibmuro: `Paneles ${muroDrawParams.propiedad}${muroDrawParams.soloPerimetro ? ' (perimetro)' : ''}${muroDrawParams.soloPrimerNivel ? ', 1er nivel' : ', todos los niveles'}`,
    apoyos: `Puntos en la base: ${apoyoEmpotrado ? 'EMPOTRADO (6 GDL)' : 'ARTICULADO (solo traslaciones)'}`,
    cargaviga: `${etiquetaCargaViga} en gravedad${(beamLoadParams.filtroSeccion || '').trim() ? `, solo seccion ${beamLoadParams.filtroSeccion}` : ', todas las vigas'}`,
    cargalosa1d: `${etiquetaCargaLosa} en losas ${losa1dParams.nombre}`,
    cargalosa2d: `${etiquetaCargaLosa} en losas ${losa2dParams.nombre}`,
    cargalosamaciza: `${etiquetaCargaLosa} en losas ${losaMacizaParams.nombre}`,
    cargamuro: `Empuje ${muroLoadParams.patron}${Number(muroLoadParams.presionDirecta) > 0 ? `: ${muroLoadParams.presionDirecta} kgf/m²` : `: Ka=${muroLoadParams.ka}, γ=${muroLoadParams.gammaSuelo} (media = Ka·γ·H/2)`} en ${muroLoadParams.propiedad}`,
    patrones: `CM (Dead, PP=1), CV (Live)${patParams.incluirCE ? ', CE (Other)' : ''} — cada uno crea su caso estatico`,
    casos: 'Automatico: un caso estatico lineal por patron; Modal y CSX/CSY en "Espectro"',
    espectro: `${espectroParams.nombreFuncion}: Z=${espectroParams.z} U=${espectroParams.u} S=${espectroParams.s} TP=${espectroParams.tp} TL=${espectroParams.tl} R=${espectroParams.r} · Ritz ${espectroParams.modosMin}-${espectroParams.modosMax} · masa ${espectroParams.masaCM}CM+${espectroParams.masaCV}CV · ${espectroParams.casoX}/${espectroParams.casoY} SF ${espectroParams.sfX}/${espectroParams.sfY}${espectroParams.orto30 ? ' +30% orto' : ''}`,
    combos: `${comboParams.incluirSismo ? '11' : (comboParams.incluirCE ? '4' : '2')} combinaciones E.060${comboParams.incluirSismo ? ` con ${comboParams.casoSismoX}/${comboParams.casoSismoY} + EMVOL + DERVX×${comboParams.factorDerivaX}/DERVY×${comboParams.factorDerivaY}` : ''}`,
    analizar: `Guardar${(analizarParams.rutaGuardado || '').trim() ? ` en ${analizarParams.rutaGuardado}` : ' (archivo actual)'} + RunAnalysis + estado de casos. Resultados en su pestana.`
  };

  // Vista previa dentro del modal de cada paso (se actualiza al escribir).
  const previewPorPaso = {
    grid: <div className="space-y-2"><SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} ejes={ejesIncPreview} /><SvgElevacion niveles={nivelesPreview} ords={ordsPreview.x} conPorticos={false} /></div>,
    losamaciza: <SvgSeccionLosa tipo="maciza" peralteCm={losaMacizaParams.espesorCm} />,
    losa1d: <SvgSeccionLosa tipo="nervada" peralteCm={losa1dParams.peralteCm} losaCm={losa1dParams.losaCm} anchoSupCm={losa1dParams.viguetaSupCm} anchoInfCm={losa1dParams.viguetaInfCm} separacionCm={losa1dParams.separacionCm} />,
    losa2d: <SvgSeccionLosa tipo="waffle" peralteCm={losa2dParams.peralteCm} losaCm={losa2dParams.losaCm} anchoSupCm={losa2dParams.nervioSupCm} anchoInfCm={losa2dParams.nervioInfCm} separacionCm={losa2dParams.separacionXCm} separacion2Cm={losa2dParams.separacionYCm} />,
    dibviga: <div className="space-y-2"><SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conPorticos /><SvgElevacion niveles={nivelesPreview} ords={ordsPreview.x} conPorticos /></div>,
    dibcolumna: <div className="space-y-2"><SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conPorticos /><SvgElevacion niveles={nivelesPreview} ords={ordsPreview.x} conPorticos /></div>,
    diblosa1d: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conPorticos conLosa etiquetaLosa={losa1dParams.nombre} />,
    diblosa2d: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conPorticos conLosa etiquetaLosa={losa2dParams.nombre} />,
    diblosamaciza: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conPorticos conLosa etiquetaLosa={losaMacizaParams.nombre} />,
    apoyos: <SvgElevacion niveles={nivelesPreview} ords={ordsPreview.x} conPorticos conApoyos empotrado={apoyoEmpotrado} />,
    cargaviga: <SvgElevacion niveles={nivelesPreview} ords={ordsPreview.x} conPorticos etiquetaCargaViga={etiquetaCargaViga} />,
    cargalosa1d: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conLosa etiquetaLosa={losa1dParams.nombre} etiquetaCarga={etiquetaCargaLosa} />,
    cargalosa2d: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conLosa etiquetaLosa={losa2dParams.nombre} etiquetaCarga={etiquetaCargaLosa} />,
    cargalosamaciza: <SvgPlanta ordsX={ordsPreview.x} ordsY={ordsPreview.y} conLosa etiquetaLosa={losaMacizaParams.nombre} etiquetaCarga={etiquetaCargaLosa} />,
    espectro: <SvgEspectro z={espectroParams.z} u={espectroParams.u} s={espectroParams.s} tp={espectroParams.tp} tl={espectroParams.tl} r={espectroParams.r} />
  };

  const formAnalizar = (
    <div>
      <div><label className={lblCls}>Ruta .EDB para guardar (vacio = automatico)</label>
        <div className="flex gap-2">
          <input value={analizarParams.rutaGuardado} onChange={e => setAnalizarParams({ rutaGuardado: e.target.value })} placeholder="Vacio = Documentos\\ETABS_API_modelos\\<proyecto>.EDB" className={inputCls} />
          <button type="button" onClick={handleElegirRutaEdb} disabled={examinandoRuta} className="shrink-0 bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 px-3 rounded-lg text-[9px] font-black uppercase text-cyan-200 whitespace-nowrap transition-colors">{examinandoRuta ? 'Abriendo...' : '📁 Examinar…'}</button>
        </div>
      </div>
      <p className="text-[9px] text-slate-500 mt-2">ETABS exige guardar el modelo antes de analizar. Si esta "(Untitled)" se guarda <b className="text-cyan-300">automaticamente</b> en Documentos\\ETABS_API_modelos\\{`<proyecto>`}.EDB (o escribe tu propia ruta). Corre TODOS los casos (Modal, estaticos, CSX/CSY) y verifica que terminen. Luego revisa la pestana 📊 Resultados.</p>
    </div>
  );

  const formAnalizar2 = (() => {
    const d = calcEspectroDiseno(disenoEspectro);
    const card = (k, v, col = 'text-cyan-200') => (
      <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5">
        <div className="text-[8px] text-slate-500 font-black uppercase tracking-wide">{k}</div>
        <div className={`text-[12px] font-black tabular-nums ${col}`}>{v}</div>
      </div>
    );
    return (
      <div>
        <p className="text-[9.5px] text-slate-500 mb-3 leading-relaxed">Re-corre el análisis con el <b className="text-cyan-300">R corregido</b> tras verificar el <b className="text-slate-300">sistema estructural</b> (R₀) y las <b className="text-slate-300">irregularidades</b> (Ia, Ip). En un clic: <b className="text-amber-300">desbloquea</b> el modelo → <b className="text-amber-300">re-aplica el espectro</b> (Sa = Z·U·C·S·g/R) → <b className="text-amber-300">re-aplica las combinaciones</b> (factores de deriva) → <b className="text-amber-300">re-corre</b> el análisis.</p>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 mb-3">
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">R corregido que se va a usar</div>
          <div className="grid grid-cols-4 gap-1.5">
            {card('R · X', d.valido ? d.Rx.toFixed(2) : '—', 'text-sky-300')}
            {card('R · Y', d.valido ? d.Ry.toFixed(2) : '—', 'text-rose-300')}
            {card('Factor deriva X', Number(comboParams.factorDerivaX) ? Number(comboParams.factorDerivaX).toFixed(3) : '—')}
            {card('Factor deriva Y', Number(comboParams.factorDerivaY) ? Number(comboParams.factorDerivaY).toFixed(3) : '—')}
          </div>
          <p className="text-[8.5px] text-slate-600 mt-2">Sistema X: <b className="text-slate-300">{(SISTEMAS_E030.find(x => x.id === disenoEspectro.sistemaX) || {}).nombre || '—'}</b> (R₀={d.R0x}) · Y: <b className="text-slate-300">{(SISTEMAS_E030.find(x => x.id === disenoEspectro.sistemaY) || {}).nombre || '—'}</b> (R₀={d.R0y}). Ia/Ip: X {d.Iax.toFixed(2)}/{d.Ipx.toFixed(2)} · Y {d.Iay.toFixed(2)}/{d.Ipy.toFixed(2)}. Vienen de «El Espectro de Diseño» (sistema + irregularidades).</p>
        </div>
        <div><label className={lblCls}>Ruta .EDB para guardar (vacio = el archivo actual)</label>
          <div className="flex gap-2">
            <input value={analizarParams.rutaGuardado} onChange={e => setAnalizarParams({ rutaGuardado: e.target.value })} placeholder="Vacio = el .EDB del 1er analisis" className={inputCls} />
            <button type="button" onClick={handleElegirRutaEdb} disabled={examinandoRuta} className="shrink-0 bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/10 px-3 rounded-lg text-[9px] font-black uppercase text-cyan-200 whitespace-nowrap transition-colors">{examinandoRuta ? 'Abriendo...' : '📁 Examinar…'}</button>
          </div>
        </div>
        <p className="text-[9px] text-amber-400/80 mt-2">⚠️ Desbloquea el modelo (descarta los resultados del 1er análisis) y vuelve a analizar con el R corregido. Asegúrate de haber <b>aplicado el sistema y las irregularidades</b> antes (su R alimenta este paso automáticamente).</p>
      </div>
    );
  })();

  const formAcero = (
    <div className="grid grid-cols-3 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={aceroParams.nombre} onChange={e => setAcero('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Fy (kg/cm2)</label><input type="number" step="100" value={aceroParams.fy} onChange={e => setAcero('fy', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Fu (kg/cm2)</label><input type="number" step="100" value={aceroParams.fu} onChange={e => setAcero('fu', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formMuroDef = (
    <div className="grid grid-cols-3 gap-3">
      <div><label className={lblCls}>Nombre</label><input value={muroDefParams.nombre} onChange={e => setMuroDef('nombre', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Material concreto</label><input list="mats-concreto" value={muroDefParams.material} onChange={e => setMuroDef('material', e.target.value)} className={inputCls} /></div>
      <div><label className={lblCls}>Espesor (cm)</label><input type="number" step="5" value={muroDefParams.espesorCm} onChange={e => setMuroDef('espesorCm', e.target.value)} className={inputCls} /></div>
    </div>
  );

  const formMuroDraw = (
    <div>
      <div><label className={lblCls}>Propiedad de muro (debe existir)</label><input value={muroDrawParams.propiedad} onChange={e => setMuroDraw('propiedad', e.target.value)} className={inputCls} /></div>
      <div className="flex items-center gap-4 mt-2">
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={muroDrawParams.soloPerimetro} onChange={e => setMuroDraw('soloPerimetro', e.target.checked)} />Solo perimetro</label>
        <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer"><input type="checkbox" className="accent-cyan-500" checked={muroDrawParams.soloPrimerNivel} onChange={e => setMuroDraw('soloPrimerNivel', e.target.checked)} />Solo 1er nivel (sotano)</label>
      </div>
      <p className="text-[9px] text-slate-500 mt-2">Dibuja paneles verticales sobre los ejes de grilla entre niveles. "Solo perimetro" = solo ejes del borde; "Solo 1er nivel" = tipico de muros de sotano (base → 1er piso).</p>
    </div>
  );

  const formMuroLoad = (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div><label className={lblCls}>Propiedad de muro</label><input value={muroLoadParams.propiedad} onChange={e => setMuroLoad('propiedad', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Patron</label><input value={muroLoadParams.patron} onChange={e => setMuroLoad('patron', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>γ suelo (kgf/m3)</label><input type="number" step="100" value={muroLoadParams.gammaSuelo} onChange={e => setMuroLoad('gammaSuelo', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Ka (empuje activo)</label><input type="number" step="0.01" value={muroLoadParams.ka} onChange={e => setMuroLoad('ka', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Altura empuje (m, 0=auto)</label><input type="number" step="0.5" value={muroLoadParams.alturaM} onChange={e => setMuroLoad('alturaM', e.target.value)} className={inputCls} /></div>
        <div><label className={lblCls}>Presion directa (kgf/m2)</label><input type="number" step="100" value={muroLoadParams.presionDirecta} onChange={e => setMuroLoad('presionDirecta', e.target.value)} className={inputCls} /></div>
      </div>
      <p className="text-[9px] text-slate-500 mt-1">Aplica el empuje como presion uniforme equivalente = Ka·γ·H/2 (misma resultante que el triangular), perpendicular al muro. Si pones "Presion directa" &gt; 0, se usa ese valor.</p>
    </div>
  );

  const formularioPorPaso = {
    grid: <>{formGrid}{botonesEjecutar(handleCreateGrid, handleInsertGrid)}</>,
    material: <>{formMaterial}{botonesEjecutar(handleCreateMaterial, handleInsertMaterial)}</>,
    acero: <>{formAcero}{botonesEjecutar(handleCreateAcero, handleInsertAcero)}</>,
    viga: <>{formViga}{botonesEjecutar(handleCreateViga, handleInsertViga)}</>,
    columna: <>{formColumna}{botonesEjecutar(handleCreateCol, handleInsertCol)}</>,
    losamaciza: <>{formLosaMaciza}{botonesEjecutar(handleCreateLosaMaciza, handleInsertLosaMaciza)}</>,
    losa1d: <>{formLosa1d}{botonesEjecutar(handleCreateLosa1d, handleInsertLosa1d)}</>,
    losa2d: <>{formLosa2d}{botonesEjecutar(handleCreateLosa2d, handleInsertLosa2d)}</>,
    muro: <>{formMuroDef}{botonesEjecutar(handleCreateMuroDef, handleInsertMuroDef)}</>,
    dibviga: <>{formDraw}{botonesEjecutar(handleCreateDibViga, handleInsertDibViga)}</>,
    dibcolumna: <>{formDraw}{botonesEjecutar(handleCreateDibCol, handleInsertDibCol)}</>,
    diblosa1d: <>{formDrawSlabInfo('losa1d')}{botonesEjecutar(() => handleCreateDibLosa('diblosa1d'), () => handleInsertDibLosa('diblosa1d'))}</>,
    diblosa2d: <>{formDrawSlabInfo('losa2d')}{botonesEjecutar(() => handleCreateDibLosa('diblosa2d'), () => handleInsertDibLosa('diblosa2d'))}</>,
    diblosamaciza: <>{formDrawSlabInfo('losamaciza')}{botonesEjecutar(() => handleCreateDibLosa('diblosamaciza'), () => handleInsertDibLosa('diblosamaciza'))}</>,
    dibmuro: <>{formMuroDraw}{botonesEjecutar(handleCreateMuroDraw, handleInsertMuroDraw)}</>,
    apoyos: <>{formApoyos}{botonesEjecutar(handleCreateApoyos, handleInsertApoyos)}</>,
    cargaviga: <>{formBeamLoads}{botonesEjecutar(handleCreateBeamLoads, handleInsertBeamLoads)}</>,
    cargalosa1d: <>{formSlabLoads}{botonesEjecutar(() => handleCreateCargaLosa('cargalosa1d'), () => handleInsertCargaLosa('cargalosa1d'))}</>,
    cargalosa2d: <>{formSlabLoads}{botonesEjecutar(() => handleCreateCargaLosa('cargalosa2d'), () => handleInsertCargaLosa('cargalosa2d'))}</>,
    cargalosamaciza: <>{formSlabLoads}{botonesEjecutar(() => handleCreateCargaLosa('cargalosamaciza'), () => handleInsertCargaLosa('cargalosamaciza'))}</>,
    cargamuro: <>{formMuroLoad}{botonesEjecutar(handleCreateMuroLoad, handleInsertMuroLoad)}</>,
    patrones: <>{formPatrones}{botonesEjecutar(handleCreatePatterns, handleInsertPatterns)}</>,
    masssource: <>{formMassSource}{botonesEjecutar(handleCreateMassSource, handleInsertMassSource)}</>,
    automesh: <>{formAutomesh}{botonesEjecutar(handleCreateAutomesh, handleInsertAutomesh)}</>,
    diafragma: <>{formDiafragma}{botonesEjecutar(handleCreateDiafragma, handleInsertDiafragma)}</>,
    endoffset: <>{formEndOffset}{botonesEjecutar(handleCreateEndOffset, handleInsertEndOffset)}</>,
    release: <>{formRelease}{botonesEjecutar(handleCreateRelease, handleInsertRelease)}</>,
    espectro: <>{formEspectro}{botonesEjecutar(handleCreateEspectro, handleInsertEspectro)}</>,
    combos: <>{formCombos}{botonesEjecutar(handleCreateCombos, handleInsertCombos)}</>,
    analizar: <>{formAnalizar}{botonesEjecutar(handleCreateAnalyze, handleInsertAnalyze)}</>,
    analizar2: <>{formAnalizar2}{botonesEjecutar(handleCreateAnalyze2, handleInsertAnalyze2)}</>,
    verifsistema: formVerifSistema,
    verifirreg: formVerifIrreg,
    casos: <div className="text-[10px] text-slate-400">Los casos estaticos se crean automaticamente al definir los patrones de carga (paso anterior). El caso Modal y los de sismo CSX/CSY se crean en "Espectro de diseno".</div>
  };

  const renderFlujo = () => {
    const implementados = WORKFLOW_STEPS.filter(s => s.implementado);
    const hechos = implementados.filter(s => stepsDone[s.id]).length;
    const pct = Math.round((hechos / implementados.length) * 100);
    const BOX_W = 180, BOX_H = 60;
    const buscar = id => WORKFLOW_STEPS.find(s => s.id === id);

    // Las 5 dependencias patrones->cargar* generaban 5 diagonales rojas cruzadas; se
    // colapsan en UNA sola flecha "bus" (ambar) dibujada aparte (busPath).
    const cargarIds = ['cargaviga', 'cargalosa1d', 'cargalosa2d', 'cargalosamaciza', 'cargamuro'];
    const aristas = [];
    WORKFLOW_STEPS.forEach(t => (t.deps || []).forEach(d => {
      const s = buscar(d);
      if (!s) return;
      if (d === 'patrones' && cargarIds.includes(t.id)) return;   // se reemplaza por el bus
      aristas.push({ s, t });
    }));

    const camino = (s, t) => {
      // Vecinos en la misma columna: salida por abajo, entrada por arriba (S vertical).
      if (Math.abs(t.pos.x - s.pos.x) < 80) {
        const sx = s.pos.x + BOX_W / 2, sy = s.pos.y + BOX_H, tx = t.pos.x + BOX_W / 2, ty = t.pos.y;
        const my = (sy + ty) / 2;
        return `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`;
      }
      // Horizontal: salida por la derecha, entrada por la izquierda (S suave).
      const sx = s.pos.x + BOX_W, sy = s.pos.y + BOX_H / 2, tx = t.pos.x, ty = t.pos.y + BOX_H / 2;
      const dx = Math.max(40, (tx - sx) * 0.5);
      return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
    };
    // Flecha unica del tren de cargas: patrones -> grupo "Asignar cargas" (entra por cargaviga).
    const pP = buscar('patrones'), cV = buscar('cargaviga');
    const busDone = !!stepsDone['patrones'];
    const busPath = (pP && cV)
      ? `M ${pP.pos.x + BOX_W} ${pP.pos.y + BOX_H / 2} C ${pP.pos.x + BOX_W + 230} ${pP.pos.y + BOX_H / 2}, ${cV.pos.x} ${cV.pos.y + BOX_H + 150}, ${cV.pos.x} ${cV.pos.y + BOX_H / 2}`
      : null;
    const colorArista = (s, t) => !t.implementado ? 'rgba(148,163,184,0.30)' : (stepsDone[s.id] ? 'rgba(52,211,153,0.85)' : 'rgba(148,163,184,0.45)');
    const flechaArista = (s, t) => (t.implementado && stepsDone[s.id]) ? 'url(#flechaV)' : 'url(#flechaG)';

    // --- Zoom y pan del lienzo del flujo ---
    const CANVAS_W = 1820, CANVAS_H = 700;
    const clampZoom = z => Math.min(2.5, Math.max(0.35, z));
    const zoomEnPunto = (nz, cx, cy) => {
      const z = flowZoom, k = clampZoom(nz) / z;
      setFlowPan(p => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
      setFlowZoom(clampZoom(nz));
    };
    const onFlowWheel = (e) => {
      const vp = flowViewportRef.current; if (!vp) return;
      const rect = vp.getBoundingClientRect();
      zoomEnPunto(flowZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left, e.clientY - rect.top);
    };
    const onFlowDown = (e) => {
      flowDragRef.current = { sx: e.clientX, sy: e.clientY, px: flowPan.x, py: flowPan.y, moved: false };
      setFlowDragging(true);
    };
    const onFlowMove = (e) => {
      const d = flowDragRef.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true;
      setFlowPan({ x: d.px + dx, y: d.py + dy });
    };
    const onFlowUp = () => {
      const d = flowDragRef.current;
      if (d && d.moved) { flowJustDragged.current = true; setTimeout(() => { flowJustDragged.current = false; }, 60); }
      flowDragRef.current = null; setFlowDragging(false);
    };
    const zoomBoton = (factor) => {
      const vp = flowViewportRef.current;
      zoomEnPunto(flowZoom * factor, vp ? vp.clientWidth / 2 : 400, vp ? vp.clientHeight / 2 : 250);
    };
    const resetVista = () => { setFlowZoom(1); setFlowPan({ x: 0, y: 0 }); };

    const clickPaso = (step) => {
      if (flowJustDragged.current) return;   // no abrir un paso si venimos de arrastrar el lienzo
      const estado = stepEstado(step);
      if (estado === 'proximamente') return showStatus('error', `"${step.titulo}" estara disponible proximamente.`);
      if (estado === 'bloqueado') {
        // Requisitos reales que faltan (atravesando placeholders no implementados).
        const faltSet = new Set();
        const walkFalt = (id, seen = new Set()) => {
          if (seen.has(id)) return; seen.add(id);
          const dep = buscar(id);
          if (!dep) return;
          if (!dep.implementado) { (dep.deps || []).forEach(x => walkFalt(x, seen)); return; }
          if (!stepsDone[id]) faltSet.add(dep.titulo);
        };
        (step.deps || []).forEach(d => walkFalt(d));
        const faltan = [...faltSet].join(', ');
        return showStatus('error', `Primero completa: ${faltan}`);
      }
      if (step.id === 'casos') return showStatus('success', 'Los casos de carga se crean automaticamente al definir los patrones.');
      setOpenStep(step.id);
    };

    const pasoModal = openStep ? buscar(openStep) : null;

    // Opciones para los <datalist> de material: el que estoy definiendo
    // localmente (matParams/aceroParams) + los detectados en el modelo.
    const concOpts = [], seenC = new Set();
    const pushC = (nombre, fc) => { if (nombre && !seenC.has(nombre)) { seenC.add(nombre); concOpts.push({ nombre, fc }); } };
    pushC(matParams.nombre, matParams.fc);
    (materialesDisponibles.concretos || []).forEach(c => pushC(c.nombre, c.fc));
    const aceroOpts = [], seenA = new Set();
    const pushA = (nombre, fy) => { if (nombre && !seenA.has(nombre)) { seenA.add(nombre); aceroOpts.push({ nombre, fy }); } };
    pushA(aceroParams.nombre, aceroParams.fy);
    pushA('A615Gr60', null);
    (materialesDisponibles.aceros || []).forEach(a => pushA(a.nombre, a.fy));

    return (
      <div className="flex-grow overflow-hidden p-6 flex flex-col min-h-0">
        <datalist id="mats-concreto">
          {concOpts.map(c => <option key={c.nombre} value={c.nombre} label={c.fc ? `f'c=${c.fc} kg/cm²` : ''} />)}
        </datalist>
        <datalist id="mats-acero">
          {aceroOpts.map(a => <option key={a.nombre} value={a.nombre} label={a.fy ? `Fy=${a.fy} kg/cm²` : ''} />)}
        </datalist>
        <div className="flex flex-col flex-grow min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">Esquema del flujo de modelado</h2>
            <span className="text-[11px] font-bold text-slate-400">{hechos} de {implementados.length} pasos · {pct}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }}></div>
          </div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex gap-2">
              <button onClick={handleDiagnosticar} className="bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-300 transition-colors">🔎 Diagnosticar modelo</button>
              <button onClick={handleReadModel} className="bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-cyan-300 transition-colors">📡 Leer modelo abierto</button>
              <button onClick={() => { if (window.confirm('Reiniciar el progreso del flujo? (no borra nada en ETABS)')) setStepsDone({}); }} className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 transition-colors">Reiniciar progreso</button>
            </div>
            <div className="flex items-center gap-3 text-[9px] font-bold text-slate-400 flex-wrap">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-emerald-400/70 bg-emerald-500/10 inline-block"></span>Hecho</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-cyan-400/70 bg-cyan-500/10 inline-block"></span>Disponible</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-white/10 bg-white/5 inline-block"></span>Bloqueado 🔒</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-dashed border-white/20 inline-block"></span>Proximamente ⏳</span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 rounded-full bg-amber-400 inline-block"></span>Patrones → cargas</span>
            </div>
          </div>

          <div ref={flowViewportRef} onWheel={onFlowWheel} onMouseDown={onFlowDown} onMouseMove={onFlowMove} onMouseUp={onFlowUp} onMouseLeave={onFlowUp}
            className="relative flex-grow overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015] select-none"
            style={{ minHeight: 340, cursor: flowDragging ? 'grabbing' : 'grab' }}>
            <div className="absolute top-0 left-0" style={{ width: CANVAS_W, height: CANVAS_H, transformOrigin: '0 0', transform: `translate(${flowPan.x}px, ${flowPan.y}px) scale(${flowZoom})` }}>
            <svg className="absolute inset-0 pointer-events-none" width="1820" height="640">
              <defs>
                <marker id="flechaV" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#34d399" /></marker>
                <marker id="flechaG" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="rgba(148,163,184,0.55)" /></marker>
                <marker id="flechaA" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#fbbf24" /></marker>
              </defs>
              {aristas.map((a, i) => {
                const punteada = !a.t.implementado || !stepsDone[a.s.id];
                return (
                  <path key={i} d={camino(a.s, a.t)} stroke={colorArista(a.s, a.t)} strokeWidth="1.7" fill="none"
                    strokeLinecap="round" strokeDasharray={punteada ? '4 6' : '0'} markerEnd={flechaArista(a.s, a.t)} />
                );
              })}
              {busPath && (
                <path d={busPath} stroke={busDone ? 'rgba(251,191,36,0.85)' : 'rgba(251,191,36,0.45)'} strokeWidth="2.2"
                  fill="none" strokeLinecap="round" strokeDasharray={busDone ? '0' : '7 6'} markerEnd="url(#flechaA)" />
              )}
            </svg>
            {/* Grupos del esquema (rotulos visuales) */}
            <div className="absolute pointer-events-none rounded-xl border border-white/10 border-dashed bg-white/[0.012]" style={{ left: 2, top: 92, width: 196, height: 158 }}>
              <span className="absolute -top-2 left-2 px-1.5 text-[7.5px] font-black uppercase tracking-widest text-slate-500 bg-[#0b0e14]">Definir materiales</span>
            </div>
            <div className="absolute pointer-events-none rounded-xl border border-amber-400/25 border-dashed bg-amber-500/[0.015]" style={{ left: 687, top: 5, width: 196, height: 450 }}>
              <span className="absolute -top-2 left-2 px-1.5 text-[7.5px] font-black uppercase tracking-widest text-amber-300/70 bg-[#0b0e14]">Asignar cargas</span>
            </div>
            <div className="absolute pointer-events-none rounded-xl border border-white/12 border-dashed bg-white/[0.012]" style={{ left: 917, top: 190, width: 196, height: 228 }}>
              <span className="absolute -top-2 left-2 px-1.5 text-[7.5px] font-black uppercase tracking-widest text-slate-500 bg-[#0b0e14]">Asignaciones</span>
            </div>

            {WORKFLOW_STEPS.map(step => {
              const estado = stepEstado(step);
              const estilos = {
                done: 'border-emerald-400/55 bg-gradient-to-br from-emerald-500/[0.14] to-emerald-500/[0.04] text-emerald-50 shadow-md shadow-emerald-500/10 hover:border-emerald-300/80 hover:shadow-emerald-500/20',
                disponible: 'border-cyan-400/70 bg-gradient-to-br from-cyan-500/[0.16] to-cyan-500/[0.04] text-cyan-50 shadow-md shadow-cyan-500/15 ring-1 ring-cyan-400/15 hover:border-cyan-300 hover:shadow-cyan-500/25',
                bloqueado: 'border-white/10 bg-white/[0.025] text-slate-500 hover:border-white/15',
                proximamente: 'border-dashed border-white/15 bg-white/[0.012] text-slate-600'
              }[estado];
              const interactivo = estado !== 'bloqueado' && estado !== 'proximamente';
              return (
                <button key={step.id} onClick={() => clickPaso(step)}
                  className={`group absolute rounded-xl border px-3 py-2 text-left transition-all duration-200 hover:z-10 ${interactivo ? 'hover:scale-[1.03] cursor-pointer' : 'cursor-not-allowed'} ${estilos}`}
                  style={{ left: step.pos.x, top: step.pos.y, width: BOX_W, height: BOX_H }}>
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 transition-transform group-hover:scale-110 ${estado === 'done' ? 'bg-emerald-500 text-black shadow shadow-emerald-500/40' : estado === 'disponible' ? 'bg-cyan-400 text-black shadow shadow-cyan-400/40' : estado === 'proximamente' ? 'bg-white/5 text-slate-500' : 'bg-slate-700/80 text-slate-400'}`}>
                      {estado === 'done' ? '✓' : estado === 'bloqueado' ? '🔒' : estado === 'proximamente' ? '⏳' : step.num}
                    </span>
                    <span className="text-[10px] font-black uppercase leading-tight tracking-wide">{step.titulo}</span>
                  </div>
                  {(() => {
                    const det = detPasoTexto(step.id, diagData);
                    return det
                      ? <div className="text-[8.5px] text-emerald-300/90 font-semibold mt-1 truncate pl-7" title={det}>{det}</div>
                      : <div className="text-[8.5px] opacity-60 mt-1 truncate pl-7">{estado === 'proximamente' ? 'Proximamente' : step.desc}</div>;
                  })()}
                </button>
              );
            })}

            {/* NODOS de las 13 irregularidades, bajo "Verificar irregularidades sismicas".
                Cada uno abre su modal individual (clic) y se colorea segun este marcada. */}
            {(() => {
              const vStep = buscar('verifirreg');
              if (!vStep) return null;
              const est = stepEstado(vStep);
              const habil = est === 'disponible' || est === 'done';
              const BW = 152, BH = 38, gx = 8, gy = 8, cols = 3, x0 = 1300;
              const alt = IRREG_NODOS.filter(n => n.grupo === 'A');
              const pla = IRREG_NODOS.filter(n => n.grupo === 'P');
              const altY0 = 392, altRows = Math.ceil(alt.length / cols);
              const plaY0 = altY0 + altRows * (BH + gy) + 24;
              const plaRows = Math.ceil(pla.length / cols);
              const xy = (i, y0) => ({ x: x0 + (i % cols) * (BW + gx), y: y0 + Math.floor(i / cols) * (BH + gy) });
              const grpX = x0 - 12, grpY = altY0 - 32;
              const grpW = cols * (BW + gx) - gx + 24;
              const grpH = (plaY0 + plaRows * (BH + gy)) - grpY + 6;
              const pcx = vStep.pos.x + BOX_W / 2, pby = vStep.pos.y + BOX_H;
              const nodo = (n, p) => {
                const activa = (disenoEspectro[n.cX] || []).includes(n.id) || (disenoEspectro[n.cY] || []).includes(n.id);
                const cls = !habil ? 'border-white/10 bg-white/[0.02] text-slate-600 cursor-not-allowed'
                  : activa ? 'border-rose-500/55 bg-rose-500/[0.08] text-rose-100 cursor-pointer hover:border-rose-400 hover:scale-[1.04] hover:z-10'
                  : 'border-cyan-400/40 bg-cyan-500/[0.05] text-cyan-50 cursor-pointer hover:border-cyan-300 hover:scale-[1.04] hover:z-10';
                return (
                  <button key={n.id} title={`${n.nombre} — ${n.criterio}`}
                    onClick={() => habil ? setOpenIrreg(n.id) : showStatus('error', 'Primero corre el 1er análisis sísmico para verificar irregularidades.')}
                    className={`group absolute rounded-lg border px-2 py-1 text-left transition-all duration-150 ${cls}`}
                    style={{ left: p.x, top: p.y, width: BW, height: BH }}>
                    <div className="flex items-center gap-1.5 h-full">
                      <span className={`w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center text-[7px] font-black ${activa ? 'bg-rose-500 text-black' : habil ? 'bg-cyan-400/80 text-black' : 'bg-slate-700 text-slate-400'}`}>{activa ? '⚠' : n.id === 'masa' ? '✓' : n.grupo}</span>
                      <span className="text-[8.5px] font-black uppercase leading-[1.05] tracking-tight">{n.nombre}</span>
                    </div>
                  </button>
                );
              };
              return (
                <>
                  <svg className="absolute top-0 left-0 pointer-events-none overflow-visible" width={CANVAS_W} height={CANVAS_H}>
                    <path d={`M ${pcx} ${pby} C ${pcx} ${(pby + grpY) / 2}, ${grpX + grpW / 2} ${(pby + grpY) / 2}, ${grpX + grpW / 2} ${grpY}`}
                      stroke="rgba(251,113,133,0.35)" strokeWidth="1.6" fill="none" strokeDasharray="5 5" />
                  </svg>
                  <div className="absolute pointer-events-none rounded-xl border border-dashed border-rose-400/25 bg-rose-500/[0.012]" style={{ left: grpX, top: grpY, width: grpW, height: grpH }}>
                    <span className="absolute -top-2 left-2 px-1.5 text-[7.5px] font-black uppercase tracking-widest text-rose-300/80 bg-[#0b0e14]">Tipos de irregularidad E.030 · clic para verificar</span>
                  </div>
                  <div className="absolute text-[7.5px] font-black uppercase tracking-widest text-slate-500 pointer-events-none" style={{ left: x0, top: altY0 - 13 }}>Altura (Ia) · Tabla N°11</div>
                  <div className="absolute text-[7.5px] font-black uppercase tracking-widest text-slate-500 pointer-events-none" style={{ left: x0, top: plaY0 - 13 }}>Planta (Ip) · Tabla N°12</div>
                  {alt.map((n, i) => nodo(n, xy(i, altY0)))}
                  {pla.map((n, i) => nodo(n, xy(i, plaY0)))}
                </>
              );
            })()}
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <button onClick={() => zoomBoton(1.2)} title="Acercar" className="w-8 h-8 rounded-lg bg-[#0d1017]/90 border border-white/15 text-slate-200 hover:bg-cyan-600/20 hover:border-cyan-500/40 text-lg font-black leading-none flex items-center justify-center transition-colors">+</button>
              <button onClick={() => zoomBoton(1 / 1.2)} title="Alejar" className="w-8 h-8 rounded-lg bg-[#0d1017]/90 border border-white/15 text-slate-200 hover:bg-cyan-600/20 hover:border-cyan-500/40 text-lg font-black leading-none flex items-center justify-center transition-colors">−</button>
              <button onClick={resetVista} title="Restablecer vista (100%)" className="w-8 h-8 rounded-lg bg-[#0d1017]/90 border border-white/15 text-slate-300 hover:bg-cyan-600/20 hover:border-cyan-500/40 text-sm flex items-center justify-center transition-colors">⤢</button>
            </div>
            <div className="absolute bottom-3 left-3 text-[9px] text-slate-600 pointer-events-none select-none">{Math.round(flowZoom * 100)}% · arrastra para mover · rueda = zoom · clic en una caja disponible para abrirla</div>
          </div>
        </div>

        {pasoModal && formularioPorPaso[pasoModal.id] && (
          <div className="fixed inset-0 z-[700] bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setOpenStep('')}>
            <div className={`anim-panel bg-[#0d1017] border border-cyan-500/25 ring-1 ring-cyan-500/10 rounded-2xl p-6 ${(previewPorPaso[pasoModal.id] || pasoModal.id === 'verifirreg' || pasoModal.id === 'verifsistema') ? 'w-[920px]' : 'w-[540px]'} max-h-[86vh] overflow-y-auto shadow-2xl shadow-black/60`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[12px] font-black text-cyan-300 uppercase tracking-widest">{pasoModal.num} · {pasoModal.titulo}</h3>
                <button onClick={() => setOpenStep('')} className="text-slate-500 hover:text-white"><X size={15} /></button>
              </div>
              <p className="text-[10px] text-slate-500 mb-4">{pasoModal.desc}</p>
              {stepsDone[pasoModal.id] && <div className="mb-3 text-[9px] font-black uppercase text-emerald-400">✓ Ya completado — puedes re-ejecutarlo si lo necesitas</div>}
              {previewPorPaso[pasoModal.id] ? (
                <div className="flex gap-5">
                  <div className="flex-1 min-w-0">{formularioPorPaso[pasoModal.id]}</div>
                  <div className="w-[350px] shrink-0">
                    <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1.5">👁 Vista previa (se actualiza al escribir)</div>
                    {previewPorPaso[pasoModal.id]}
                    <p className="text-[8.5px] text-slate-600 mt-2">{resumenPorPaso[pasoModal.id]}</p>
                  </div>
                </div>
              ) : formularioPorPaso[pasoModal.id]}
            </div>
          </div>
        )}

        {openIrreg && (() => {
          const n = IRREG_NODOS.find(x => x.id === openIrreg);
          if (!n) return null;
          return (
            <div className="fixed inset-0 z-[710] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setOpenIrreg('')}>
              <div className="anim-panel bg-[#0d1017] border border-rose-500/25 ring-1 ring-rose-500/10 rounded-2xl p-6 w-[640px] max-h-[88vh] overflow-y-auto shadow-2xl shadow-black/60" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[12px] font-black text-rose-300 uppercase tracking-widest">{n.grupo === 'A' ? 'Irregularidad en altura (Ia)' : 'Irregularidad en planta (Ip)'} · {n.nombre}</h3>
                  <button onClick={() => setOpenIrreg('')} className="text-slate-500 hover:text-white"><X size={15} /></button>
                </div>
                {renderIrregCard(n, n.cX, n.cY)}
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-white/10">
                  <p className="text-[8.5px] text-slate-500 leading-relaxed flex-1">{['masa', 'torsion', 'torsionExt', 'rigidez', 'rigidezExt', 'geomVert', 'diafragma', 'noParalelo', 'esquinas'].includes(n.id) ? 'Verificación automática disponible (botón arriba). ' : 'Verificación automática: próximamente (necesita capacidad de diseño / cortante). '}Marca «Existe en X / Y» según corresponda; afecta <b className="text-slate-300">R = R₀·Ia·Ip</b> en todo el flujo.</p>
                  <button onClick={() => setOpenIrreg('')} className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-lg text-[9px] font-black uppercase text-slate-200 transition-colors">Cerrar</button>
                </div>
              </div>
            </div>
          );
        })()}

        {diagOpen && diagData && (() => {
          const g = diagData;
          // Celda de nombre con insignia "por defecto" para los que trae ETABS.
          const nb = (x) => x.default
            ? <span className="inline-flex items-center gap-1.5">{x.nombre}<span className="px-1.5 py-px rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[7.5px] font-black uppercase tracking-wider">por defecto</span></span>
            : x.nombre;
          const secFilas = arr => (arr || []).map(s => [nb(s), `${s.base ?? '?'} × ${s.peralte ?? '?'}`, s.material || '—']);
          const losas = [...(g.losas_maciza || []), ...(g.losas_1d || []), ...(g.losas_2d || [])];
          const nPasos = Object.values(g.pasos || {}).filter(Boolean).length;
          const chip = 'px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 font-bold';
          return (
            <div className="fixed inset-0 z-[700] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setDiagOpen(false)}>
              <div className="anim-panel bg-[#0d1017] border border-emerald-500/25 ring-1 ring-emerald-500/10 rounded-2xl p-6 w-[900px] max-h-[88vh] overflow-y-auto shadow-2xl shadow-black/60" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[12px] font-black text-emerald-300 uppercase tracking-widest">🔎 Diagnóstico del modelo · inventario</h3>
                  <button onClick={() => setDiagOpen(false)} className="text-slate-500 hover:text-white"><X size={15} /></button>
                </div>
                <p className="text-[10px] text-slate-500 mb-3 truncate">{g.modelo}</p>

                <div className="mb-4 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.03] p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest mb-2 text-cyan-300">Sistema de grilla y pisos</div>
                  <div className="grid grid-cols-3 gap-3 text-[10px]">
                    <div>
                      <div className="text-slate-500 font-bold mb-0.5">Pisos ({(g.pisos || []).length})</div>
                      <div className="text-slate-200">{(g.pisos || []).join(', ') || '—'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-bold mb-0.5">Ejes X ({(g.grilla_x || []).length})</div>
                      <div className="text-slate-200">{(g.grilla_x || []).length ? `${g.grilla_x.join(', ')} m` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 font-bold mb-0.5">Ejes Y ({(g.grilla_y || []).length})</div>
                      <div className="text-slate-200">{(g.grilla_y || []).length ? `${g.grilla_y.join(', ')} m` : '—'}</div>
                    </div>
                  </div>
                  {(g.elevaciones || []).length > 0 && (
                    <div className="text-[9px] text-slate-500 mt-2">Elevaciones: {g.elevaciones.join(', ')} m · base z = {g.base_z} m</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-6">
                  <div>
                    <DiagBlock accent="emerald" titulo="Materiales · concreto" cols={["Nombre", "f'c (kg/cm²)", "E (kg/cm²)"]}
                      vacio="Sin concreto" filas={(g.concretos || []).map(c => [nb(c), c.fc ?? '—', c.modulo ?? '—'])} />
                    <DiagBlock accent="emerald" titulo="Materiales · acero de refuerzo" cols={["Nombre", "Fy (kg/cm²)", "Fu (kg/cm²)"]}
                      vacio="Sin acero de refuerzo" filas={(g.aceros || []).map(a => [nb(a), a.fy ?? '—', a.fu ?? '—'])} />
                    <DiagBlock accent="emerald" titulo="Otros materiales" cols={["Nombre", "Tipo", "E (kg/cm²)"]}
                      vacio="Sin otros materiales" filas={(g.otros_materiales || []).map(o => [nb(o), o.tipo, o.modulo ?? '—'])} />
                    <DiagBlock titulo="Secciones de viga" cols={["Nombre", "b × h (cm)", "Material"]}
                      vacio="Sin vigas definidas" filas={secFilas(g.secciones_viga)} />
                    <DiagBlock titulo="Secciones de columna" cols={["Nombre", "b × h (cm)", "Material"]}
                      vacio="Sin columnas definidas" filas={secFilas(g.secciones_columna)} />
                  </div>
                  <div>
                    <DiagBlock titulo="Losas" cols={["Nombre", "Tipo", "e (cm)"]}
                      vacio="Sin losas definidas" filas={losas.map(l => [nb(l), l.tipo || '—', l.espesor ?? '—'])} />
                    <DiagBlock titulo="Muros" cols={["Nombre", "e (cm)", "Material"]}
                      vacio="Sin muros definidos" filas={(g.muros || []).map(m => [nb(m), m.espesor ?? '—', m.material || '—'])} />
                    <DiagBlock titulo="Patrones de carga" cols={["Nombre", "Tipo"]}
                      vacio="Sin patrones" filas={(g.patrones || []).map(p => [nb(p), p.tipo])} />
                    <DiagBlock titulo="Casos de carga" cols={["Nombre", "Tipo"]}
                      vacio="Sin casos" filas={(g.casos || []).map(c => [c.nombre, c.tipo])} />
                    <DiagBlock titulo="Combinaciones" cols={["Nombre", "Fórmula"]}
                      vacio="Sin combinaciones" filas={(g.combinaciones || []).map(c => [c.nombre, c.formula])} />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                  <span className={chip}>Frames dibujados: <b className="text-white">{g.num_frames}</b></span>
                  <span className={chip}>Áreas: <b className="text-white">{g.num_areas}</b></span>
                  <span className={chip}>Apoyos: <b className="text-white">{g.apoyos ? 'sí' : 'no'}</b></span>
                  <span className={chip}>Análisis: <b className="text-white">{g.analizado ? 'corrido' : 'no'}</b></span>
                </div>
                <div className="mt-3 text-[10px] text-emerald-300 font-bold">✓ {nPasos} pasos del flujo auto-marcados en el diagrama según lo detectado.</div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ----- Vista de PREVISUALIZACION DEL MODELO (planta, elevacion, registro) -----
  const handleVistaLeerModelo = async () => {
    setVistaModelInfo('Leyendo el modelo abierto en ETABS...');
    const r = await fetchModelSummary();
    setVistaResumen(r || null);
    if (r) aplicarMaterialesDetectados(r.concretos, r.aceros);
    setVistaModelInfo(r ? formatModelSummary(r) : 'No se pudo leer el modelo: revisa que ETABS este abierto y el servidor activo (sin banner rojo).');
  };

  // ----- EL ESPECTRO DE DISENO (E.030-2026): reemplaza la antigua Vista previa -----
  const renderVista = () => {
    const card = 'bg-white/[0.02] border border-white/5 rounded-2xl p-4';
    const titulo = 'text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-2';
    const selCls = 'w-full bg-black/30 border border-white/10 hover:border-white/20 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/15 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-100 outline-none cursor-pointer transition-colors';
    const lbl = 'text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1';
    const d = calcEspectroDiseno(disenoEspectro);
    const unidad = d.g === 1 ? '(Sa/g)' : '(m/s²)';
    const setD = (campo, valor) => setDisenoEspectro(prev => ({ ...prev, [campo]: valor }));
    const toggleIrreg = (campo, id) => setDisenoEspectro(prev => {
      const arr = prev[campo] || [];
      return { ...prev, [campo]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
    });
    const descargarTxt = (nombre, contenido) => {
      const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    };
    const txtDir = key => d.puntos.map(p => `${p.t}\t${p[key].toFixed(6)}`).join('\n');
    const copiarTabla = () => {
      const txt = ['T\tSa_X\tSa_Y', ...d.puntos.map(p => `${p.t}\t${p.sax.toFixed(6)}\t${p.say.toFixed(6)}`)].join('\n');
      navigator.clipboard?.writeText(txt).then(
        () => showStatus('success', 'Tabla T–Sa copiada (T, Sa X, Sa Y).'),
        () => showStatus('error', 'No se pudo copiar al portapapeles.'));
    };
    const aplicarEspectroAlPaso = () => {
      if (!d.valido) return showStatus('error', `El suelo ${d.suelo.id} no está tabulado para la ${d.zona.nombre} (requiere EMS).`);
      const r4 = v => Math.round(v * 1e4) / 1e4;
      const sfY = d.Ry ? r4(d.Rx / d.Ry) : 1;
      setEspectroParams(prev => ({ ...prev, z: d.Z, u: d.U, s: d.S, tp: d.TP, tl: d.TL, r: r4(d.Rx), sfX: 1, sfY }));
      showStatus('success', `Aplicado al paso Espectro: Z=${d.Z} U=${d.U} S=${d.S} TP=${d.TP} TL=${d.TL} · R=${r4(d.Rx)} (SF Y=${sfY}${Math.abs(d.Rx - d.Ry) > 1e-6 ? ` por Ry=${r4(d.Ry)}` : ''}).`);
    };
    // Exporta el espectro a una hoja Excel PRESENTABLE con FORMULAS VIVAS + gráfico
    // (lo genera el servidor con openpyxl: build_espectro_xlsx). Se descarga el .xlsx.
    const exportarEspectroExcel = async () => {
      if (!d.valido) return showStatus('error', 'El suelo no está tabulado para esa zona (requiere EMS). Ajusta zona/suelo.');
      showStatus('success', 'Generando Excel del espectro…');
      try {
        const payload = {
          z: d.Z, u: d.U, s: d.S, tp: d.TP, tl: d.TL, g: d.g,
          r0x: d.R0x, iax: d.Iax, ipx: d.Ipx, r0y: d.R0y, iay: d.Iay, ipy: d.Ipy,
          periodos: (d.puntos || []).map(p => p.t),
          zona: ZONAS_E030.find(x => x.id === disenoEspectro.zona)?.nombre,
          suelo: SUELOS_E030.find(x => x.id === disenoEspectro.suelo)?.nombre,
          uso: USOS_E030.find(x => x.id === disenoEspectro.uso)?.nombre,
          sistemaX: SISTEMAS_E030.find(x => x.id === disenoEspectro.sistemaX)?.nombre,
          sistemaY: SISTEMAS_E030.find(x => x.id === disenoEspectro.sistemaY)?.nombre,
          proyecto: `Espectro E.030-2026 · ${proyecto}`,
        };
        const resp = await fetch(`${config.pythonUrl}/espectro/excel`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const ct = resp.headers.get('content-type') || '';
        if (!resp.ok || ct.includes('application/json')) {
          const e = await resp.json().catch(() => ({}));
          return showStatus('error', e.error || 'No se pudo generar el Excel.');
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Espectro E030-2026.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showStatus('success', 'Excel del espectro descargado (con fórmulas vivas y gráfico).');
      } catch {
        showStatus('error', 'No se pudo conectar al servidor para generar el Excel.');
      }
    };
    const dato = (k, v, col = 'text-cyan-200') => (
      <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5">
        <div className="text-[8px] text-slate-500 font-black uppercase tracking-wide">{k}</div>
        <div className={`text-[12px] font-black tabular-nums ${col}`}>{v}</div>
      </div>
    );
    const tablaIrreg = (lista, campoX, campoY, tit, accentY) => (
      <>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-black text-cyan-300 uppercase tracking-widest">{tit}</span>
          <span className="text-[8px] text-slate-500 font-black"><span className="text-sky-300">X</span> / <span className={accentY}>Y</span></span>
        </div>
        <div className="space-y-1">
          {lista.map(it => {
            const onX = (disenoEspectro[campoX] || []).includes(it.id);
            const onY = (disenoEspectro[campoY] || []).includes(it.id);
            return (
              <div key={it.id} className="flex items-center gap-2 text-[9px]">
                <span className="flex-1 text-slate-300 truncate" title={it.nombre}>{it.nombre}</span>
                <span className="text-slate-600 tabular-nums w-7 text-right">{it.f.toFixed(2)}</span>
                <input type="checkbox" checked={onX} onChange={() => toggleIrreg(campoX, it.id)} className="accent-sky-500 w-3.5 h-3.5 cursor-pointer" title={`${it.nombre} en X`} />
                <input type="checkbox" checked={onY} onChange={() => toggleIrreg(campoY, it.id)} className="accent-rose-500 w-3.5 h-3.5 cursor-pointer" title={`${it.nombre} en Y`} />
              </div>
            );
          })}
        </div>
      </>
    );
    const btnExp = 'bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase text-cyan-200 transition-colors';
    return (
      <div className="flex-grow overflow-auto p-6">
        <div className="mx-auto" style={{ width: 1160 }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">📈 El Espectro de Diseño · Norma E.030-2026</h2>
              <p className="text-[9px] text-slate-500 mt-1">Pseudo-aceleraciones <b className="text-slate-400">Sa = Z·U·C·S·g / R</b>. Elige zona, suelo, uso y sistema; marca las irregularidades por dirección. <b className="text-slate-400">R = R₀·Ia·Ip</b>.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setD('adimensional', !disenoEspectro.adimensional)} title="Sa en m/s² (×g=9.81) o adimensional Sa/g" className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-200 transition-colors">{disenoEspectro.adimensional ? 'Sa/g (adim.)' : 'Sa en m/s²'}</button>
              <button onClick={exportarEspectroExcel} title="Genera una hoja Excel presentable con fórmulas vivas y gráfico" className="bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-300 transition-colors">📊 Exportar a Excel</button>
              <button onClick={aplicarEspectroAlPaso} className="bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20 transition-all">⚡ Aplicar al paso Espectro</button>
            </div>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: '360px 1fr' }}>
            <div className="space-y-4 self-start">
              <div className={card}>
                <div className={titulo}>Parámetros sísmicos</div>
                <div className="space-y-2.5">
                  <div><label className={lbl}>Zona sísmica (Z)</label>
                    <select value={disenoEspectro.zona} onChange={e => setD('zona', e.target.value)} className={selCls}>{ZONAS_E030.map(z => <option key={z.id} value={z.id}>{z.nombre} · Z={z.z}</option>)}</select></div>
                  <div><label className={lbl}>Tipo de suelo (S, TP, TL)</label>
                    <select value={disenoEspectro.suelo} onChange={e => setD('suelo', e.target.value)} className={selCls}>{SUELOS_E030.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></div>
                  <div><label className={lbl}>Categoría de uso (U)</label>
                    <select value={disenoEspectro.uso} onChange={e => setD('uso', e.target.value)} className={selCls}>{USOS_E030.map(u => <option key={u.id} value={u.id}>{u.nombre} · U={u.u}</option>)}</select></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={lbl}>Sistema X (R₀)</label>
                      <select value={disenoEspectro.sistemaX} onChange={e => setD('sistemaX', e.target.value)} className={selCls}>{SISTEMAS_E030.map(s => <option key={s.id} value={s.id}>{s.nombre} · R₀={s.r0}</option>)}</select></div>
                    <div><label className={lbl}>Sistema Y (R₀)</label>
                      <select value={disenoEspectro.sistemaY} onChange={e => setD('sistemaY', e.target.value)} className={selCls}>{SISTEMAS_E030.map(s => <option key={s.id} value={s.id}>{s.nombre} · R₀={s.r0}</option>)}</select></div>
                  </div>
                </div>
              </div>
              <div className={card}>{tablaIrreg(IRREG_ALTURA, 'iaX', 'iaY', 'Irregularidad en altura (Ia)', 'text-rose-300')}</div>
              <div className={card}>{tablaIrreg(IRREG_PLANTA, 'ipX', 'ipY', 'Irregularidad en planta (Ip)', 'text-rose-300')}</div>
            </div>

            <div className="space-y-4">
              <div className={card}>
                <div className={titulo}>Resumen del cálculo</div>
                {d.valido ? (
                  <>
                    <div className="grid grid-cols-6 gap-1.5 mb-1.5">
                      {dato('Z', d.Z)}{dato('U', d.U)}{dato('S', d.S)}{dato('TP (s)', d.TP)}{dato('TL (s)', d.TL)}{dato('g', d.g === 1 ? '1' : '9.81')}
                      {dato('R₀ X', d.R0x)}{dato('Ia X', d.Iax)}{dato('Ip X', d.Ipx)}{dato('R₀ Y', d.R0y)}{dato('Ia Y', d.Iay)}{dato('Ip Y', d.Ipy)}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {dato('R · X', d.Rx.toFixed(2), 'text-sky-300')}{dato('R · Y', d.Ry.toFixed(2), 'text-rose-300')}
                      {dato(`Sa máx X ${unidad}`, d.saMaxX.toFixed(3), 'text-sky-300')}{dato(`Sa máx Y ${unidad}`, d.saMaxY.toFixed(3), 'text-rose-300')}
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] text-amber-300/90 font-bold bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">El suelo {d.suelo.id} no está tabulado para la {d.zona.nombre}: requiere un estudio de sitio (EMS). Elige otra combinación zona/suelo.</div>
                )}
              </div>
              <div className={card}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Curva Sa – T {unidad}</div>
                  <div className="text-[8.5px] text-slate-500 font-bold">paso Espectro: {stepsDone.espectro ? <span className="text-emerald-400">✓ creado</span> : 'por crear'}</div>
                </div>
                <SvgEspectroDiseno datos={d} width={736} />
              </div>
            </div>
          </div>

          <div className={`${card} mt-4`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Tabla T – Sa (para exportar a ETABS) · {d.puntos.length} puntos</div>
              <div className="flex gap-1.5">
                <button onClick={copiarTabla} disabled={!d.valido} className={`${btnExp} disabled:opacity-40`}>📋 Copiar (T, Sa X, Sa Y)</button>
                <button onClick={() => descargarTxt('Espectro_E030_X.txt', txtDir('sax'))} disabled={!d.valido} className={`${btnExp} disabled:opacity-40`}>⬇️ TXT X</button>
                <button onClick={() => descargarTxt('Espectro_E030_Y.txt', txtDir('say'))} disabled={!d.valido} className={`${btnExp} disabled:opacity-40`}>⬇️ TXT Y</button>
              </div>
            </div>
            {d.valido ? (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-white/5">
                <table className="w-full text-[9px] tabular-nums">
                  <thead className="sticky top-0 bg-[#0b0e14] z-10">
                    <tr className="text-left text-slate-500">
                      <th className="py-1.5 px-3 font-black">T (s)</th>
                      <th className="py-1.5 px-3 font-black">C</th>
                      <th className="py-1.5 px-3 font-black text-sky-300">Sa X {unidad}</th>
                      <th className="py-1.5 px-3 font-black text-rose-300">Sa Y {unidad}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.puntos.map((p, i) => (
                      <tr key={i} className="border-t border-white/5 hover:bg-white/[0.03]">
                        <td className="py-0.5 px-3 text-slate-300">{p.t}</td>
                        <td className="py-0.5 px-3 text-slate-400">{p.c.toFixed(4)}</td>
                        <td className="py-0.5 px-3 text-sky-200">{p.sax.toFixed(5)}</td>
                        <td className="py-0.5 px-3 text-rose-200">{p.say.toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-[10px] text-amber-300/90 py-3">Sin tabla: la combinación zona/suelo no está tabulada.</div>}
            <p className="text-[8.5px] text-slate-600 mt-2">En ETABS: <b className="text-slate-400">Define → Functions → Response Spectrum → From File</b> con el TXT (pares T, Sa). O usa <b className="text-cyan-300">⚡ Aplicar al paso Espectro</b> para crear la función de usuario <b className="text-slate-400">{espectroParams.nombreFuncion}</b> automáticamente con estos Z/U/S/TP/TL/R (regla 19: Database Tables).</p>
          </div>
        </div>
      </div>
    );
  };

  // ----- MODELADOR (mini-CAD): dibujar elementos sobre la grilla -----
  const renderModelador = () => {
    const cardCls = 'bg-white/[0.025] border border-white/[0.07] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.35)]';
    const xs = ordsPreview.x, ys = ordsPreview.y;
    const niv = Math.min(Math.max(0, nivelVista), nivelesPreview.length - 1);
    const hayGrilla = xs.length >= 2 && ys.length >= 2;
    const puedeDibujar = hayGrilla && niv >= 1;
    const W = 1090, M = 46;
    const minX = hayGrilla ? Math.min(...xs) : 0, maxX = hayGrilla ? Math.max(...xs) : 1;
    const minY = hayGrilla ? Math.min(...ys) : 0, maxY = hayGrilla ? Math.max(...ys) : 1;
    const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
    const Hc = Math.max(380, Math.min(640, Math.round((W - 2 * M) * spanY / spanX) + 2 * M));
    const sx = x => M + (x - minX) / spanX * (W - 2 * M);
    const sy = y => Hc - M - (y - minY) / spanY * (Hc - 2 * M);

    const gReal = diagData || vistaResumen;
    const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
    const optsCol = uniq([colParams.nombre, ...(gReal?.secciones_columna || []).map(s => s.nombre)]);
    const optsVig = uniq([vigaParams.nombre, ...(gReal?.secciones_viga || []).map(s => s.nombre)]);
    const optsLos = uniq([losaMacizaParams.nombre, losa1dParams.nombre, losa2dParams.nombre,
      ...[...(gReal?.losas_maciza || []), ...(gReal?.losas_1d || []), ...(gReal?.losas_2d || [])].map(l => l.nombre)]);
    const optsMur = uniq([muroDefParams.nombre, ...(gReal?.muros || []).map(m => m.nombre)]);
    const secActual = { columna: modSec.columna || colParams.nombre, viga: modSec.viga || vigaParams.nombre, losa: modSec.losa || losaMacizaParams.nombre, muro: modSec.muro || muroDefParams.nombre };
    const optsTool = { columna: optsCol, viga: optsVig, losa: optsLos, muro: optsMur };

    const toData = e => {
      const svg = lienzoRef.current; if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      return { px: (e.clientX - rect.left) * (W / rect.width), py: (e.clientY - rect.top) * (Hc / rect.height) };
    };
    // SNAP (OSNAP): segun los modos activos -> intersecciones de grilla, extremos
    // y puntos medios de lo dibujado. Con OSNAP off o sin punto cercano = libre.
    const ptosSnap = [];
    if (snapOn && snapModes.grid) xs.forEach(x => ys.forEach(y => ptosSnap.push({ x, y, tipo: 'grid' })));
    // Punto MEDIO tambien de la MALLA: centro de cada borde de grilla (X e Y).
    if (snapOn && snapModes.med) {
      for (let i = 0; i < xs.length - 1; i++) ys.forEach(y => ptosSnap.push({ x: (xs[i] + xs[i + 1]) / 2, y, tipo: 'med' }));
      for (let j = 0; j < ys.length - 1; j++) xs.forEach(x => ptosSnap.push({ x, y: (ys[j] + ys[j + 1]) / 2, tipo: 'med' }));
    }
    if (snapOn) dibujoElementos.filter(el => el.nivel === niv).forEach(el => {
      if (el.tipo === 'columna') { if (snapModes.fin) ptosSnap.push({ x: el.x, y: el.y, tipo: 'fin' }); }
      else if (el.tipo === 'viga' || el.tipo === 'muro') {
        if (snapModes.fin) ptosSnap.push({ x: el.x1, y: el.y1, tipo: 'fin' }, { x: el.x2, y: el.y2, tipo: 'fin' });
        if (snapModes.med) ptosSnap.push({ x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2, tipo: 'med' });
      }
    });
    const libre = (px, py) => ({ x: minX + (px - M) / (W - 2 * M) * spanX, y: minY + (Hc - M - py) / (Hc - 2 * M) * spanY, tipo: 'libre' });
    const snap = (px, py) => { let best = null, bd = 22 * 22; ptosSnap.forEach(p => { const d = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2; if (d < bd) { bd = d; best = p; } }); return best || libre(px, py); };
    const snapCelda = (px, py) => {
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
        if (px >= sx(xs[i]) && px <= sx(xs[i + 1]) && py <= sy(ys[j]) && py >= sy(ys[j + 1])) return { ci: i, cj: j };
      }
      return null;
    };
    const distSeg = (ax, ay, bx, by, px, py) => { const x1 = sx(ax), y1 = sy(ay), x2 = sx(bx), y2 = sy(by), dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1; let t = ((px - x1) * dx + (py - y1) * dy) / L; t = Math.max(0, Math.min(1, t)); return Math.hypot(x1 + t * dx - px, y1 + t * dy - py); };
    const distEl = (el, px, py) => {
      if (el.tipo === 'columna') return Math.hypot(sx(el.x) - px, sy(el.y) - py);
      if (el.tipo === 'viga' || el.tipo === 'muro') return distSeg(el.x1, el.y1, el.x2, el.y2, px, py);
      const dentro = px >= sx(el.x0) && px <= sx(el.x1) && py <= sy(el.y0) && py >= sy(el.y1);
      return dentro ? 0 : Math.hypot((sx(el.x0) + sx(el.x1)) / 2 - px, (sy(el.y0) + sy(el.y1)) / 2 - py);
    };
    const elemCercano = (px, py, tipos) => { const c = dibujoElementos.filter(el => el.nivel === niv && (!tipos || tipos.includes(el.tipo))).map(el => ({ el, dd: distEl(el, px, py) })).sort((a, b) => a.dd - b.dd)[0]; return c && c.dd < 16 ? c.el : null; };
    const extremoCercano = (px, py) => {
      let best = null, bd = 16 * 16;
      dibujoElementos.filter(el => el.nivel === niv).forEach(el => {
        const test = (x, y, cual) => { const d = (sx(x) - px) ** 2 + (sy(y) - py) ** 2; if (d < bd) { bd = d; best = { id: el.id, cual }; } };
        if (el.tipo === 'columna') test(el.x, el.y, 'p');
        else if (el.tipo === 'viga' || el.tipo === 'muro') { test(el.x1, el.y1, '1'); test(el.x2, el.y2, '2'); }
      });
      return best;
    };
    const proyT = (el, px, py) => { const x1 = sx(el.x1), y1 = sy(el.y1), x2 = sx(el.x2), y2 = sy(el.y2), dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1; return Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)); };
    const pixAm = (px, py) => ({ x: minX + (px - M) / (W - 2 * M) * spanX, y: minY + (Hc - M - py) / (Hc - 2 * M) * spanY });
    const baseLinea = el => ({ tipo: el.tipo, nivel: el.nivel, sec: el.sec, ...(el.tipo === 'viga' ? { z: el.z } : { zBot: el.zBot, zTop: el.zTop }) });
    const trasladar = (el, dx, dy) => el.tipo === 'columna' ? { ...el, x: el.x + dx, y: el.y + dy }
      : el.tipo === 'losa' ? { ...el, x0: el.x0 + dx, x1: el.x1 + dx, y0: el.y0 + dy, y1: el.y1 + dy }
        : { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    // Aplica una transformacion fn(x,y)->{x,y} a TODOS los puntos del elemento.
    const mapPts = (el, fn) => {
      if (el.tipo === 'columna') { const p = fn(el.x, el.y); return { ...el, x: p.x, y: p.y }; }
      if (el.tipo === 'losa') { const pts = losaPts(el).map(q => fn(q.x, q.y)); return { ...el, pts }; }
      const p1 = fn(el.x1, el.y1), p2 = fn(el.x2, el.y2); return { ...el, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    };
    const fnEspejo = (ax, ay, bx, by) => (x, y) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1; const t = ((x - ax) * dx + (y - ay) * dy) / L; const fx = ax + t * dx, fy = ay + t * dy; return { x: 2 * fx - x, y: 2 * fy - y }; };
    const fnRot = (cx, cy, ang) => (x, y) => { const dx = x - cx, dy = y - cy, c = Math.cos(ang), s = Math.sin(ang); return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }; };
    const ortho = (a, b) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y, tipo: b.tipo } : { x: a.x, y: b.y, tipo: b.tipo };
    const nid = () => Date.now() + Math.random();
    const addEl = el => setDibujoElementos(prev => [...prev, { id: nid(), ...el }]);
    // Grips (nodos) editables del elemento seleccionado.
    const gripsDe = el => {
      if (!el) return [];
      if (el.tipo === 'columna') return [{ cual: 'p', x: el.x, y: el.y }];
      if (el.tipo === 'viga' || el.tipo === 'muro') return [{ cual: '1', x: el.x1, y: el.y1 }, { cual: '2', x: el.x2, y: el.y2 }, { cual: 'm', x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 }];
      return losaPts(el).map((q, i) => ({ cual: 'v' + i, x: q.x, y: q.y }));
    };
    const gripCercano = (px, py) => {
      const el = dibujoElementos.find(e => e.id === modSel && e.nivel === niv); if (!el) return null;
      let best = null, bd = 13 * 13;
      gripsDe(el).forEach(g => { const d = (sx(g.x) - px) ** 2 + (sy(g.y) - py) ** 2; if (d < bd) { bd = d; best = { id: el.id, cual: g.cual }; } });
      return best;
    };
    const aplicarGrip = (el, cual, p) => {
      if (el.tipo === 'columna') return { ...el, x: p.x, y: p.y };
      if (el.tipo === 'viga' || el.tipo === 'muro') {
        if (cual === '1') return { ...el, x1: p.x, y1: p.y };
        if (cual === '2') return { ...el, x2: p.x, y2: p.y };
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2, dx = p.x - mx, dy = p.y - my;
        return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
      }
      const i = parseInt(String(cual).slice(1), 10) || 0;
      const pts = losaPts(el).map((q, k) => k === i ? { x: p.x, y: p.y } : q);
      return { ...el, pts };
    };
    // One / Similar / All stories: a que niveles replicar lo que se dibuja.
    const nivelesObjetivo = () => {
      if (storyMode === 'all') return nivelesPreview.map((_, i) => i).filter(i => i >= 1);
      if (storyMode === 'similar') { const s = [...simStories].filter(i => i >= 1); return s.length ? s : [niv]; }
      return [niv];
    };
    const crearEnNiveles = base => {
      const targets = [...new Set([niv, ...nivelesObjetivo()])].filter(L => L >= 1 && L < nivelesPreview.length).sort((a, b) => a - b);
      const nuevos = targets.map(L => {
        const zT = nivelesPreview[L], zB = nivelesPreview[L - 1] ?? 0;
        return (base.tipo === 'columna' || base.tipo === 'muro') ? { id: nid(), ...base, nivel: L, zBot: zB, zTop: zT } : { id: nid(), ...base, nivel: L, z: zT };
      });
      setDibujoElementos(prev => [...prev, ...nuevos]);
    };

    const onMove = e => {
      const d = toData(e); if (!d) return;
      if (['columna', 'viga', 'muro', 'polilinea', 'losa', 'stretch', 'mover', 'copiar', 'mirror', 'rotar'].includes(modTool) || (modTool === 'sel' && modGrab)) setModHover({ pt: snap(d.px, d.py) });
      else setModHover(null);
    };
    // Creacion por un punto p={x,y} (clic con snap O coordenada escrita 'x,y').
    const colocar = p => {
      if (!puedeDibujar) return;
      const igual = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
      const orth = a => (orthoOn && p.tipo !== 'coord') ? ortho(a, p) : p;
      if (modTool === 'columna') crearEnNiveles({ tipo: 'columna', x: p.x, y: p.y, sec: secActual.columna });
      else if (modTool === 'viga' || modTool === 'muro') {
        if (!modPend) { setModPend(p); return; }
        const q = orth(modPend); if (igual(modPend, q)) { setModPend(null); return; }
        crearEnNiveles({ tipo: modTool, x1: modPend.x, y1: modPend.y, x2: q.x, y2: q.y, sec: secActual[modTool] });
        setModPend(null);
      } else if (modTool === 'polilinea') {
        if (!modPoly) { setModPoly(p); return; }
        const q = orth(modPoly); if (igual(modPoly, q)) { setModPoly(null); return; }
        crearEnNiveles({ tipo: 'viga', x1: modPoly.x, y1: modPoly.y, x2: q.x, y2: q.y, sec: secActual.viga });
        setModPoly(q);
      } else if (modTool === 'losa') {
        const pts = modLosaPts || [];
        if (pts.length >= 3 && igual(pts[0], p)) { crearEnNiveles({ tipo: 'losa', pts, sec: secActual.losa }); setModLosaPts(null); }
        else setModLosaPts([...pts, { x: p.x, y: p.y }]);
      }
    };
    const onClick = e => {
      const d = toData(e); if (!d) return;
      // --- Seleccion + edicion por GRIPS (nodos) ---
      if (modTool === 'sel') {
        if (modGrab) { const p = snap(d.px, d.py); setDibujoElementos(prev => prev.map(el => el.id !== modGrab.id ? el : aplicarGrip(el, modGrab.cual, p))); setModGrab(null); return; }
        const g = gripCercano(d.px, d.py); if (g) { setModGrab(g); return; }
        const el = elemCercano(d.px, d.py); setModSel(el ? el.id : null); setModGrab(null);
        return;
      }
      // --- Edicion sobre lo existente ---
      if (modTool === 'borrar') { const el = elemCercano(d.px, d.py); if (el) { setDibujoElementos(prev => prev.filter(x => x.id !== el.id)); if (modSel === el.id) setModSel(null); } return; }
      if (modTool === 'break') {
        const el = elemCercano(d.px, d.py, ['viga', 'muro']); if (!el) return;
        const t = proyT(el, d.px, d.py); if (t <= 0.02 || t >= 0.98) return;
        const mx = el.x1 + t * (el.x2 - el.x1), my = el.y1 + t * (el.y2 - el.y1), b = baseLinea(el);
        setDibujoElementos(prev => [...prev.filter(x => x.id !== el.id), { id: nid(), ...b, x1: el.x1, y1: el.y1, x2: mx, y2: my }, { id: nid(), ...b, x1: mx, y1: my, x2: el.x2, y2: el.y2 }]);
        return;
      }
      if (modTool === 'offset') {
        const el = elemCercano(d.px, d.py, ['viga', 'muro']); if (!el) return;
        const dist = Math.abs(Number(modOffsetDist)) || 0.5;
        const dx = el.x2 - el.x1, dy = el.y2 - el.y1, L = Math.hypot(dx, dy) || 1;
        let nx = -dy / L, ny = dx / L;
        const c = pixAm(d.px, d.py);
        const lado = ((c.x - el.x1) * nx + (c.y - el.y1) * ny) >= 0 ? 1 : -1;
        nx *= dist * lado; ny *= dist * lado;
        addEl({ ...baseLinea(el), x1: el.x1 + nx, y1: el.y1 + ny, x2: el.x2 + nx, y2: el.y2 + ny });
        return;
      }
      if (modTool === 'stretch') {
        if (!modGrab) { const g = extremoCercano(d.px, d.py); if (g) setModGrab(g); return; }
        const p = snap(d.px, d.py); if (!p) { setModGrab(null); return; }
        setDibujoElementos(prev => prev.map(el => el.id !== modGrab.id ? el : modGrab.cual === 'p' ? { ...el, x: p.x, y: p.y } : modGrab.cual === '1' ? { ...el, x1: p.x, y1: p.y } : { ...el, x2: p.x, y2: p.y }));
        setModGrab(null);
        return;
      }
      if (modTool === 'mover') {
        if (!modMove) { const el = modSel ? dibujoElementos.find(x => x.id === modSel) : elemCercano(d.px, d.py); if (!el) return; setModSel(el.id); const p = snap(d.px, d.py); setModMove({ id: el.id, bx: p.x, by: p.y }); return; }
        const p = snap(d.px, d.py); const dx = p.x - modMove.bx, dy = p.y - modMove.by;
        setDibujoElementos(prev => prev.map(el => el.id !== modMove.id ? el : trasladar(el, dx, dy)));
        setModMove(null);
        return;
      }
      if (modTool === 'copiar') {
        if (!modMove) { const el = modSel ? dibujoElementos.find(x => x.id === modSel) : elemCercano(d.px, d.py); if (!el) return; setModSel(el.id); const p = snap(d.px, d.py); setModMove({ id: el.id, bx: p.x, by: p.y }); return; }
        const p = snap(d.px, d.py); const el = dibujoElementos.find(x => x.id === modMove.id);
        if (el) addEl(mapPts(el, (x, y) => ({ x: x + (p.x - modMove.bx), y: y + (p.y - modMove.by) })));
        setModMove(null);
        return;
      }
      if (modTool === 'mirror') {
        if (!modSel) return showStatus('error', 'Selecciona un elemento primero (herramienta Sel o el árbol).');
        const p = snap(d.px, d.py);
        if (!modPend) { setModPend(p); return; }
        const el = dibujoElementos.find(x => x.id === modSel);
        if (el) addEl(mapPts(el, fnEspejo(modPend.x, modPend.y, p.x, p.y)));
        setModPend(null);
        return;
      }
      if (modTool === 'rotar') {
        if (!modSel) return showStatus('error', 'Selecciona un elemento primero.');
        const p = snap(d.px, d.py); const el = dibujoElementos.find(x => x.id === modSel);
        if (el) addEl(mapPts(el, fnRot(p.x, p.y, (Number(rotAng) || 90) * Math.PI / 180)));
        return;
      }
      // --- Creacion por punto (columna/viga/muro/polilinea/losa poligonal) ---
      colocar(snap(d.px, d.py));
    };

    const generar = () => {
      if (!dibujoElementos.length) return showStatus('error', 'No hay elementos dibujados todavia.');
      const body = buildDibujoManualBody({
        columnas: dibujoElementos.filter(e => e.tipo === 'columna'),
        vigas: dibujoElementos.filter(e => e.tipo === 'viga'),
        losas: dibujoElementos.filter(e => e.tipo === 'losa'),
        muros: dibujoElementos.filter(e => e.tipo === 'muro'),
      });
      const script = assembleScript({ modeValue: 'feed_current_model', unidades: Number.parseInt(selectedUnits, 10) || 8, body });
      setPythonCode(script);
      setLastCodeFromAi(false);
      setMainTab('codigo');
      showStatus('success', `Script generado con ${dibujoElementos.length} elementos. Revisa y ejecuta en Codigo + Terminal.`);
    };
    const elegirTool = k => { setModTool(k); setModPend(null); setModPoly(null); setModGrab(null); setModMove(null); };
    const aplicarArray = () => {
      if (!modSel) return showStatus('error', 'Selecciona un elemento primero.');
      const el = dibujoElementos.find(x => x.id === modSel); if (!el) return;
      const nx = Math.max(1, Math.round(Number(arrayP.nx) || 1)), ny = Math.max(1, Math.round(Number(arrayP.ny) || 1));
      const dx = Number(arrayP.dx) || 0, dy = Number(arrayP.dy) || 0;
      const nuevos = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (i === 0 && j === 0) continue; nuevos.push({ id: nid(), ...mapPts(el, (x, y) => ({ x: x + i * dx, y: y + j * dy })) }); }
      if (nuevos.length) setDibujoElementos(prev => [...prev, ...nuevos]);
      showStatus('success', `Array: ${nuevos.length} copias creadas.`);
    };
    // Mover (o copiar) el seleccionado una distancia EXACTA dx,dy en metros.
    const desplazarSel = (dx, dy, copia) => {
      if (!modSel) { showStatus('error', 'Selecciona un elemento primero.'); return; }
      const el = dibujoElementos.find(x => x.id === modSel); if (!el) return;
      if (copia) addEl(mapPts(el, (x, y) => ({ x: x + dx, y: y + dy })));
      else setDibujoElementos(prev => prev.map(e => e.id === modSel ? trasladar(e, dx, dy) : e));
      showStatus('success', `${copia ? 'Copia' : 'Movido'} dx=${dx} dy=${dy} m.`);
    };
    const CMD = { L: 'viga', LINE: 'viga', V: 'viga', VIGA: 'viga', PL: 'polilinea', POLI: 'polilinea', POL: 'polilinea', C: 'columna', COL: 'columna', COLUMNA: 'columna', M: 'muro', MU: 'muro', MURO: 'muro', LO: 'losa', LOSA: 'losa', SLAB: 'losa', MV: 'mover', MO: 'mover', MOVE: 'mover', MOVER: 'mover', CO: 'copiar', COPY: 'copiar', COPIAR: 'copiar', MI: 'mirror', MIRROR: 'mirror', ESPEJO: 'mirror', RO: 'rotar', ROTATE: 'rotar', ROTAR: 'rotar', O: 'offset', OFFSET: 'offset', BR: 'break', BREAK: 'break', ST: 'stretch', STRETCH: 'stretch', E: 'borrar', BORRAR: 'borrar', ERASE: 'borrar', S: 'sel', SEL: 'sel' };
    const procesarComando = txt => {
      const k = String(txt || '').trim().toUpperCase();
      setModCmd('');
      if (!k) return;
      const mCoord = k.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (mCoord) {
        const a = Number(mCoord[1]), b = Number(mCoord[2]);
        if (modTool === 'mover' || modTool === 'copiar') desplazarSel(a, b, modTool === 'copiar');
        else if (['columna', 'viga', 'muro', 'polilinea'].includes(modTool)) colocar({ x: a, y: b, tipo: 'coord' });
        else showStatus('error', 'Escribe "x,y": con C/L/M/PL = punto absoluto; con Mover/Copiar = desplazamiento exacto.');
        return;
      }
      if (CMD[k]) { elegirTool(CMD[k]); showStatus('success', `Herramienta activa: ${CMD[k]}`); }
      else showStatus('error', `Comando "${k}" no reconocido. Prueba C, L, PL, M, LO, MV, CO, MI, RO, O, BR, ST, E o "x,y".`);
    };
    const secTool = modTool === 'polilinea' ? 'viga' : modTool;
    const tools = [['sel', '➤', 'Sel'], ['columna', '■', 'Columna'], ['viga', '╱', 'Viga'], ['polilinea', 'PL', 'Polilín.'], ['losa', '▦', 'Losa'], ['muro', '▬', 'Muro'], ['mover', '✥', 'Mover'], ['copiar', '⧉', 'Copiar'], ['mirror', '◫', 'Espejo'], ['rotar', '↻', 'Rotar'], ['offset', '⇉', 'Offset'], ['break', '✂', 'Break'], ['stretch', '↔', 'Stretch'], ['borrar', '✕', 'Borrar']];
    const colorTipo = { columna: '#3b82f6', viga: '#34d399', muro: '#a78bfa', losa: 'rgba(59,130,246,0.7)' };
    const cnt = t => dibujoElementos.filter(e => e.tipo === t).length;
    const elementosNivel = dibujoElementos.filter(e => e.nivel === niv);
    const estadoTxt = modTool === 'sel' ? (modGrab ? 'clic el nuevo punto del nodo' : modSel ? 'arrastra un nodo (cuadro azul) para estirar · o edita en el panel · Supr borra' : 'clic sobre un elemento para seleccionar')
      : modTool === 'borrar' ? 'clic sobre un elemento para borrar'
        : modTool === 'offset' ? `clic sobre viga/muro (offset ${modOffsetDist} m al lado del clic)`
          : modTool === 'break' ? 'clic sobre viga/muro para partirla'
            : modTool === 'stretch' ? (modGrab ? 'clic el nuevo punto del extremo' : 'clic cerca de un extremo para agarrarlo')
              : modTool === 'mover' ? (modMove ? 'clic el punto destino' : 'clic un elemento (será el punto base)')
                : modTool === 'copiar' ? (modMove ? 'clic el punto destino de la copia' : 'clic el elemento (punto base)')
                  : modTool === 'mirror' ? (!modSel ? 'selecciona un elemento primero' : modPend ? 'clic el 2º punto del eje de espejo' : 'clic el 1er punto del eje')
                    : modTool === 'rotar' ? (!modSel ? 'selecciona un elemento primero' : `clic el centro de rotación (${rotAng}°)`)
                      : modTool === 'polilinea' ? (modPoly ? 'clic siguiente punto (Esc termina)' : 'clic el primer punto')
                        : (modPend ? 'clic el 2º punto (Esc cancela)' : 'clic en la grilla');

    const gridSvg = (
      <>
        {hayGrilla && xs.map((x, i) => (
          <g key={`gx${i}`}>
            <line x1={sx(x)} y1={sy(maxY)} x2={sx(x)} y2={sy(minY)} stroke="rgba(148,163,184,0.32)" strokeWidth="1" strokeDasharray="5 4" />
            <circle cx={sx(x)} cy={sy(maxY) - 14} r="9" fill="#0b0e14" stroke="rgba(59,130,246,0.6)" strokeWidth="1" />
            <text x={sx(x)} y={sy(maxY) - 11} textAnchor="middle" fontSize="8.5" fill="#93c5fd" fontWeight="700">{i + 1}</text>
          </g>
        ))}
        {hayGrilla && ys.map((y, j) => (
          <g key={`gy${j}`}>
            <line x1={sx(minX)} y1={sy(y)} x2={sx(maxX)} y2={sy(y)} stroke="rgba(148,163,184,0.32)" strokeWidth="1" strokeDasharray="5 4" />
            <circle cx={sx(minX) - 16} cy={sy(y)} r="9" fill="#0b0e14" stroke="rgba(59,130,246,0.6)" strokeWidth="1" />
            <text x={sx(minX) - 16} y={sy(y) + 3} textAnchor="middle" fontSize="8.5" fill="#93c5fd" fontWeight="700">{ETIQUETAS_ABC[j % 26]}</text>
          </g>
        ))}
        {elementosNivel.map(el => {
          const c = colorDeSeccion(el.sec);
          if (el.tipo === 'losa') return <polygon key={el.id} points={losaPts(el).map(q => `${sx(q.x)},${sy(q.y)}`).join(' ')} fill={c} fillOpacity="0.18" stroke={c} strokeOpacity="0.7" strokeWidth="1.5" />;
          if (el.tipo === 'viga') return <line key={el.id} x1={sx(el.x1)} y1={sy(el.y1)} x2={sx(el.x2)} y2={sy(el.y2)} stroke={c} strokeWidth="4" strokeLinecap="round" />;
          if (el.tipo === 'muro') return <line key={el.id} x1={sx(el.x1)} y1={sy(el.y1)} x2={sx(el.x2)} y2={sy(el.y2)} stroke={c} strokeWidth="7" strokeLinecap="round" opacity="0.85" />;
          return <rect key={el.id} x={sx(el.x) - 5} y={sy(el.y) - 5} width="10" height="10" fill={c} stroke="#0b0e14" strokeWidth="1.5" />;
        })}
        {(() => { const el = dibujoElementos.find(e => e.id === modSel && e.nivel === niv); if (!el) return null;
          if (el.tipo === 'losa') return <polygon points={losaPts(el).map(q => `${sx(q.x)},${sy(q.y)}`).join(' ')} fill="none" stroke="#fbbf24" strokeWidth="2.5" />;
          if (el.tipo === 'columna') return <rect x={sx(el.x) - 8} y={sy(el.y) - 8} width="16" height="16" fill="none" stroke="#fbbf24" strokeWidth="2.5" />;
          return <line x1={sx(el.x1)} y1={sy(el.y1)} x2={sx(el.x2)} y2={sy(el.y2)} stroke="#fbbf24" strokeWidth={el.tipo === 'muro' ? 11 : 8} strokeLinecap="round" opacity="0.45" />;
        })()}
        {modLosaPts && modLosaPts.length > 0 && (() => { const h = modHover && modHover.pt; const pts = [...modLosaPts, ...(h ? [h] : [])];
          return <g><polyline points={pts.map(q => `${sx(q.x)},${sy(q.y)}`).join(' ')} fill="rgba(59,130,246,0.08)" stroke="#fbbf24" strokeWidth="2" strokeDasharray="5 4" />{modLosaPts.map((q, i) => <circle key={`lp${i}`} cx={sx(q.x)} cy={sy(q.y)} r={i === 0 ? 5 : 3.5} fill={i === 0 ? '#fbbf24' : '#60a5fa'} />)}</g>;
        })()}
        {modTool === 'sel' && (() => { const el = dibujoElementos.find(e => e.id === modSel && e.nivel === niv); if (!el) return null;
          return gripsDe(el).map((g, i) => <rect key={`grip${i}`} x={sx(g.x) - 4.5} y={sy(g.y) - 4.5} width="9" height="9" fill={modGrab && modGrab.cual === g.cual ? '#fbbf24' : '#60a5fa'} stroke="#0b0e14" strokeWidth="1" />);
        })()}
        {modHover && modHover.pt && (() => { const p = modHover.pt; const X = sx(p.x), Y = sy(p.y);
          return p.tipo === 'med' ? <path d={`M ${X} ${Y - 7} L ${X + 6} ${Y + 5} L ${X - 6} ${Y + 5} Z`} fill="none" stroke="#a3e635" strokeWidth="2" />
            : p.tipo === 'fin' ? <rect x={X - 5} y={Y - 5} width="10" height="10" fill="none" stroke="#f472b6" strokeWidth="2" />
              : <rect x={X - 6} y={Y - 6} width="12" height="12" fill="none" stroke="#fbbf24" strokeWidth="2" />;
        })()}
        {modHover && modHover.celda && modTool === 'losa' && (
          <rect x={sx(xs[modHover.celda.ci])} y={sy(ys[modHover.celda.cj + 1])} width={sx(xs[modHover.celda.ci + 1]) - sx(xs[modHover.celda.ci])} height={sy(ys[modHover.celda.cj]) - sy(ys[modHover.celda.cj + 1])} fill="rgba(251,191,36,0.12)" stroke="#fbbf24" strokeWidth="1.5" />
        )}
        {(() => { const a = modPend || modPoly || (modMove ? { x: modMove.bx, y: modMove.by } : null); if (!a) return null; const h = modHover && modHover.pt;
          return <g><circle cx={sx(a.x)} cy={sy(a.y)} r="5" fill="#fbbf24" />{h && <line x1={sx(a.x)} y1={sy(a.y)} x2={sx(h.x)} y2={sy(h.y)} stroke="#fbbf24" strokeWidth="2" strokeDasharray="5 4" />}</g>;
        })()}
        {modGrab && (() => { const el = dibujoElementos.find(e => e.id === modGrab.id); if (!el) return null; const gx = modGrab.cual === 'p' ? el.x : modGrab.cual === '1' ? el.x1 : el.x2; const gy = modGrab.cual === 'p' ? el.y : modGrab.cual === '1' ? el.y1 : el.y2; return <circle cx={sx(gx)} cy={sy(gy)} r="8" fill="#fbbf24" opacity="0.5" />; })()}
      </>
    );

    const barraIzq = (
      <div className="flex flex-col gap-1 bg-white/[0.02] border border-white/5 rounded-xl p-1.5 shrink-0 self-start">
        {tools.map(([k, ic, lbl]) => (
          <button key={k} title={lbl} onClick={() => elegirTool(k)}
            className={`w-11 h-11 flex flex-col items-center justify-center rounded-lg border text-[6.5px] font-black uppercase leading-none transition-colors ${modTool === k ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200' : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'}`}>
            <span className="text-[14px] leading-none mb-0.5">{ic}</span>{lbl}
          </button>
        ))}
      </div>
    );

    const snapBtn = (k, lbl) => (
      <button onClick={() => setSnapModes(p => ({ ...p, [k]: !p[k] }))}
        className={`px-2 py-1 rounded-md text-[8.5px] font-black uppercase border transition-colors ${snapModes[k] ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200' : 'bg-white/5 border-white/10 text-slate-500'}`}>{lbl}</button>
    );

    const sel = dibujoElementos.find(e => e.id === modSel) || null;
    const setSelProp = (campo, valor) => setDibujoElementos(prev => prev.map(el => el.id !== modSel ? el : { ...el, [campo]: valor }));
    const setSelCoord = (campo, valor) => { const v = Number(valor); if (!Number.isNaN(v)) setSelProp(campo, v); };
    const setSelNivel = niNew => setDibujoElementos(prev => prev.map(el => {
      if (el.id !== modSel) return el;
      const zT = nivelesPreview[niNew], zB = nivelesPreview[niNew - 1] ?? 0;
      return (el.tipo === 'viga' || el.tipo === 'losa') ? { ...el, nivel: niNew, z: zT } : { ...el, nivel: niNew, zBot: zB, zTop: zT };
    }));
    const etiquetaEl = el => ({ columna: 'Col', viga: 'Viga', muro: 'Muro', losa: 'Losa' }[el.tipo]) + ' · ' + el.sec;
    const numInput = (campo, lbl) => (
      <label key={campo} className="flex items-center gap-1 text-[9px]"><span className="w-6 text-slate-500 font-bold">{lbl}</span>
        <input type="number" step="0.25" value={sel[campo] ?? 0} onChange={e => setSelCoord(campo, e.target.value)} className="w-full bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-[9px] text-cyan-200 outline-none" /></label>
    );

    const panelDer = (
      <div className="w-56 shrink-0 space-y-2 self-start">
        <div className={cardCls}>
          <button onClick={handleLeerModeloGeo} disabled={modGeoLoading} className="w-full bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 px-3 py-2 rounded-xl text-[9.5px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20 transition-all">{modGeoLoading ? 'Leyendo...' : '📥 Leer de ETABS'}</button>
          <button onClick={llevarAEtabs} className="w-full mt-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 px-3 py-2 rounded-xl text-[9.5px] font-black uppercase tracking-widest text-white shadow-lg shadow-amber-500/20 transition-all">⬆️ Llevar a ETABS</button>
          <div className="text-[8px] text-slate-500 mt-1.5 leading-tight">Leer = trae lo que hay en ETABS. Llevar = sincroniza: dibuja los nuevos y borra los que quitaste (genera el script para revisar y ejecutar).</div>
          {modeloGeo && <div className="text-[8px] text-cyan-300/80 mt-1 font-bold">En ETABS: {modeloGeo.conteo?.columna || 0} col · {modeloGeo.conteo?.viga || 0} vigas · {modeloGeo.conteo?.losa || 0} losas · {modeloGeo.conteo?.muro || 0} muros</div>}
          <div className="mt-2 pt-2 border-t border-white/5">
            <span className="text-[8px] font-black text-cyan-300 uppercase tracking-widest block mb-1">Fuente de grilla</span>
            <select value={fuenteGrilla} onChange={e => setFuenteGrilla(e.target.value)} className="w-full bg-black/40 border border-white/10 px-2 py-1 rounded-lg text-[9px] font-bold text-slate-200 outline-none cursor-pointer">
              <option value="uniforme">Formulario uniforme</option>
              <option value="noUniforme">Ordenadas (no uniforme)</option>
              <option value="real">Modelo real (leído)</option>
            </select>
          </div>
        </div>

        <div className={cardCls}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black text-cyan-300 uppercase tracking-widest">Snap · OSNAP</span>
            <button onClick={() => setSnapOn(s => !s)} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${snapOn ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-white/5 text-slate-500 border-white/10'}`}>{snapOn ? 'ON' : 'OFF'}</button>
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">{snapBtn('grid', 'Grilla')}{snapBtn('fin', 'Extremo')}{snapBtn('med', 'Medio')}
            <button onClick={() => setOrthoOn(o => !o)} className={`px-2 py-1 rounded-md text-[8.5px] font-black uppercase border transition-colors ${orthoOn ? 'bg-amber-500/20 border-amber-400/50 text-amber-200' : 'bg-white/5 border-white/10 text-slate-500'}`}>Orto</button>
          </div>
        </div>

        <div className={cardCls}>
          <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1.5">Pisos al dibujar (story)</div>
          <div className="flex gap-1">
            {[['one', 'Un piso'], ['similar', 'Similares'], ['all', 'Todos']].map(([k, lbl]) => (
              <button key={k} onClick={() => setStoryMode(k)} className={`flex-1 px-1 py-1 rounded text-[8.5px] font-black uppercase border transition-colors ${storyMode === k ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200' : 'bg-white/5 border-white/10 text-slate-400'}`}>{lbl}</button>
            ))}
          </div>
          {storyMode === 'similar' && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {nivelesPreview.map((z, i) => i >= 1 ? (
                <button key={i} onClick={() => setSimStories(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${simStories.has(i) ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-200' : 'bg-white/5 border-white/10 text-slate-500'}`}>N{i}</button>
              ) : null)}
            </div>
          )}
          {storyMode !== 'one' && <p className="text-[8px] text-amber-300/80 mt-1.5">Lo que dibujes se crea en {storyMode === 'all' ? 'TODOS los pisos' : 'los pisos marcados'}.</p>}
        </div>

        {['columna', 'viga', 'polilinea', 'losa', 'muro'].includes(modTool) && (
          <div className={cardCls}>
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Sección · {secTool}</div>
            <input list={`secop-${secTool}`} value={secActual[secTool]} onChange={e => setModSec(p => ({ ...p, [secTool]: e.target.value }))}
              className="w-full bg-black/40 border border-cyan-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-cyan-200 outline-none" />
            <datalist id={`secop-${secTool}`}>{(optsTool[secTool] || []).map(s => <option key={s} value={s} />)}</datalist>
          </div>
        )}
        {modTool === 'offset' && (
          <div className={cardCls}>
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Distancia offset (m)</div>
            <input type="number" step="0.05" value={modOffsetDist} onChange={e => setModOffsetDist(e.target.value)} className="w-full bg-black/40 border border-cyan-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-cyan-200 outline-none" />
          </div>
        )}
        {modTool === 'rotar' && (
          <div className={cardCls}>
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Ángulo de rotación (°)</div>
            <input type="number" step="15" value={rotAng} onChange={e => setRotAng(e.target.value)} className="w-full bg-black/40 border border-cyan-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-cyan-200 outline-none" />
          </div>
        )}
        {(modTool === 'mover' || modTool === 'copiar') && (
          <div className={cardCls}>
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">{modTool === 'copiar' ? 'Copiar' : 'Mover'} distancia exacta (m)</div>
            <div className="flex items-center gap-1 mb-1.5">
              <label className="flex items-center gap-1 text-[9px] flex-1"><span className="w-5 text-slate-500 font-bold">dX</span><input type="number" step="0.05" value={moveP.dx} onChange={e => setMoveP(p => ({ ...p, dx: e.target.value }))} className="w-full bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-[9px] text-cyan-200 outline-none" /></label>
              <label className="flex items-center gap-1 text-[9px] flex-1"><span className="w-5 text-slate-500 font-bold">dY</span><input type="number" step="0.05" value={moveP.dy} onChange={e => setMoveP(p => ({ ...p, dy: e.target.value }))} className="w-full bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-[9px] text-cyan-200 outline-none" /></label>
            </div>
            <button onClick={() => desplazarSel(Number(moveP.dx) || 0, Number(moveP.dy) || 0, modTool === 'copiar')} disabled={!modSel} className="w-full bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 disabled:opacity-40 text-cyan-200 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Aplicar a la selección</button>
            <p className="text-[8px] text-slate-500 mt-1">o escribe <b className="text-emerald-300">{`${moveP.dx || 0.5},0`}</b> en el comando.</p>
          </div>
        )}
        {modTool === 'losa' && (
          <div className={cardCls}>
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">Losa poligonal</div>
            <p className="text-[8.5px] text-slate-400 mb-1.5">Clic los vértices (3+). Cierra clicando el 1er punto, o:</p>
            <button onClick={() => { if ((modLosaPts || []).length >= 3) { crearEnNiveles({ tipo: 'losa', pts: modLosaPts, sec: secActual.losa }); setModLosaPts(null); } }} disabled={(modLosaPts || []).length < 3} className="w-full bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 disabled:opacity-40 text-cyan-200 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Cerrar losa ({(modLosaPts || []).length} pts)</button>
          </div>
        )}

        <div className={cardCls}>
          <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1.5">Árbol de objetos ({dibujoElementos.length})</div>
          <div className="max-h-36 overflow-y-auto space-y-0.5">
            {dibujoElementos.length === 0 && <div className="text-[9px] text-slate-600 italic px-1">Sin objetos dibujados</div>}
            {dibujoElementos.map(el => (
              <button key={el.id} onClick={() => { setModSel(el.id); setModTool('sel'); if (el.nivel !== niv) setNivelVista(el.nivel); }}
                className={`w-full flex items-center justify-between px-2 py-1 rounded text-[9px] transition-colors ${modSel === el.id ? 'bg-amber-500/20 text-amber-200' : 'hover:bg-white/5 text-slate-300'}`}>
                <span className="flex items-center gap-1.5 truncate"><span style={{ color: colorDeSeccion(el.sec) }}>●</span>{etiquetaEl(el)}</span>
                <span className="text-slate-500 shrink-0">N{el.nivel}</span>
              </button>
            ))}
          </div>
        </div>

        {sel && (
          <div className={cardCls}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-black text-amber-300 uppercase tracking-widest">Propiedades</span>
              <button onClick={() => { setDibujoElementos(prev => prev.filter(e => e.id !== modSel)); setModSel(null); }} className="px-2 py-0.5 rounded bg-red-600/15 border border-red-500/30 text-red-300 text-[8px] font-black uppercase">🗑 Borrar</button>
            </div>
            <div className="flex items-center gap-1 text-[9px] text-slate-400 mb-1.5">{etiquetaEl(sel)} · nivel
              <select value={sel.nivel} onChange={e => setSelNivel(Number(e.target.value))} className="bg-black/40 border border-white/10 px-1 py-0.5 rounded text-[9px] text-slate-200">
                {nivelesPreview.map((z, i) => <option key={i} value={i}>N{i}</option>)}
              </select>
            </div>
            <div className="mb-1.5">
              <span className="text-[8px] text-slate-500 uppercase font-bold">Sección</span>
              <input list={`secp-${sel.tipo}`} value={sel.sec} onChange={e => setSelProp('sec', e.target.value)} className="w-full bg-black/40 border border-cyan-500/30 px-1.5 py-0.5 rounded text-[9px] text-cyan-200 outline-none" />
              <datalist id={`secp-${sel.tipo}`}>{(optsTool[sel.tipo] || []).map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {sel.tipo === 'columna' && [['x', 'X'], ['y', 'Y']].map(([c, l]) => numInput(c, l))}
              {(sel.tipo === 'viga' || sel.tipo === 'muro') && [['x1', 'X1'], ['y1', 'Y1'], ['x2', 'X2'], ['y2', 'Y2']].map(([c, l]) => numInput(c, l))}
              {sel.tipo === 'losa' && [['x0', 'X0'], ['x1', 'X1'], ['y0', 'Y0'], ['y1', 'Y1']].map(([c, l]) => numInput(c, l))}
            </div>
            <div className="border-t border-white/10 mt-2 pt-2">
              <div className="text-[8px] text-slate-500 uppercase font-bold mb-1">Array (matriz)</div>
              <div className="grid grid-cols-2 gap-1 mb-1">
                {[['nx', 'Cols'], ['ny', 'Filas'], ['dx', 'dX m'], ['dy', 'dY m']].map(([c, l]) => (
                  <label key={c} className="flex items-center gap-1 text-[9px]"><span className="w-9 text-slate-500 font-bold">{l}</span><input type="number" step="0.25" value={arrayP[c]} onChange={e => setArrayP(p => ({ ...p, [c]: e.target.value }))} className="w-full bg-black/40 border border-white/10 px-1 py-0.5 rounded text-[9px] text-cyan-200 outline-none" /></label>
                ))}
              </div>
              <button onClick={aplicarArray} className="w-full bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 px-2 py-1 rounded-lg text-[9px] font-black uppercase">Aplicar array</button>
            </div>
          </div>
        )}

        <div className={cardCls}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black text-cyan-300 uppercase tracking-widest">Nivel</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setNivelVista(Math.min(nivelesPreview.length - 1, niv + 1))} className="w-5 h-5 flex items-center justify-center rounded bg-white/5 hover:bg-cyan-500/20 border border-white/10 text-cyan-300 text-[10px] font-black">▲</button>
              <select value={niv} onChange={e => setNivelVista(Number(e.target.value))} className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-[9px] font-bold text-slate-200 outline-none cursor-pointer">
                {nivelesPreview.map((z, i) => <option key={i} value={i}>{`N${i} +${z.toFixed(1)}`}</option>)}
              </select>
              <button onClick={() => setNivelVista(Math.max(0, niv - 1))} className="w-5 h-5 flex items-center justify-center rounded bg-white/5 hover:bg-cyan-500/20 border border-white/10 text-cyan-300 text-[10px] font-black">▼</button>
            </div>
          </div>
          {[['columna', 'Columnas'], ['viga', 'Vigas'], ['losa', 'Losas'], ['muro', 'Muros']].map(([t, lbl]) => (
            <div key={t} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: colorTipo[t] }}></span>{lbl}</span>
              <b className="text-white">{cnt(t)}</b>
            </div>
          ))}
          <div className="border-t border-white/10 mt-1.5 pt-1.5 flex items-center justify-between text-[10px]"><span className="font-bold text-slate-400">TOTAL</span><b className="text-cyan-300">{dibujoElementos.length}</b></div>
        </div>

        <div className={cardCls}>
          <button onClick={generar} disabled={!dibujoElementos.length} className="w-full bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 px-3 py-2 rounded-xl text-[9.5px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20 transition-all">⚙️ Generar script</button>
          <div className="flex gap-1.5 mt-2">
            <button onClick={deshacerDibujo} title="Ctrl+Z" className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase text-slate-300">↶ Deshacer</button>
            <button onClick={rehacerDibujo} title="Ctrl+Y" className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 rounded-lg text-[9px] font-black uppercase text-slate-300">↷ Rehacer</button>
            <button onClick={() => { if (window.confirm('¿Borrar TODO el dibujo? (no afecta a ETABS)')) setDibujoElementos([]); }} disabled={!dibujoElementos.length} className="bg-red-600/15 hover:bg-red-600/30 border border-red-500/30 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase text-red-300">🗑</button>
          </div>
        </div>
      </div>
    );

    const lineaComando = (
      <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl px-3 py-1.5 flex-wrap">
        <span className="text-[9px] font-black text-cyan-400 uppercase">Comando</span>
        <input ref={cmdRef} value={modCmd} onChange={e => setModCmd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') procesarComando(modCmd); }}
          placeholder="escribe un comando o x,y · L PL C M LO MV CO MI RO O BR ST E · Enter · Esc cancela" className="bg-black/40 border border-white/10 px-2.5 py-1 rounded-lg text-[10px] font-mono text-emerald-300 outline-none flex-1 min-w-[180px] focus:border-cyan-500/50" />
        <span className="text-[8.5px] text-amber-300/90 font-bold">N{niv} · {estadoTxt}</span>
        <button onClick={() => setModMax(m => !m)} className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/35 border border-cyan-500/40 text-cyan-200 text-[9px] font-black uppercase">{modMax ? '⤡ Minimizar' : '⤢ Maximizar'}</button>
      </div>
    );

    const lienzoBox = (
      <div className={`relative ${modMax ? 'flex-1 min-h-0 overflow-auto' : 'w-full'}`}>
        <svg ref={lienzoRef} viewBox={`0 0 ${W} ${Hc}`} width="100%" onClick={onClick} onMouseMove={onMove} onMouseLeave={() => setModHover(null)}
          className="bg-black/30 rounded-lg border border-white/10" style={{ cursor: modTool === 'sel' ? 'default' : 'crosshair', touchAction: 'none' }}>
          {gridSvg}
        </svg>
        {!hayGrilla && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500 text-center px-8">Define una grilla (pestaña Vista previa) para empezar a dibujar.</div>}
        {hayGrilla && !puedeDibujar && <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[9px] font-bold px-3 py-1 rounded-lg">Sube a un nivel ≥ N1 para dibujar (N0 es la base).</div>}
      </div>
    );

    const espacioTrabajo = (
      <div className={modMax ? 'fixed inset-0 z-[800] bg-[#070a10] p-2 flex flex-col gap-2' : 'flex flex-col gap-2'}>
        <div className={`flex gap-2 ${modMax ? 'flex-1 min-h-0 items-stretch' : 'items-start'}`}>
          {barraIzq}
          <div className={`${cardCls} flex-1 flex flex-col min-w-0 p-2`}>{lienzoBox}</div>
          {panelDer}
        </div>
        {lineaComando}
      </div>
    );

    return (
      <div className="flex-grow overflow-auto p-6">
        <div className="mx-auto" style={{ width: 1160 }}>
          {!modMax && (
            <div className="mb-3">
              <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">✏️ Modelador · estilo AutoCAD</h2>
              <p className="text-[9px] text-slate-500 mt-1">Barra de herramientas a la izquierda, opciones de snap a la derecha, línea de comando abajo. Dibuja en la grilla del nivel activo (Esc cancela) y genera el script de ETABS. Comandos: L, PL, C, M, LO, MV (mover), O, BR, ST, E.</p>
            </div>
          )}
          {espacioTrabajo}
          {!modMax && (
            <div className={`${cardCls} mt-4`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">Vista 3D · dibuja o borra aquí también</div>
                <div className="text-[8.5px] text-slate-500 font-bold">{dibujoElementos.length} elementos · N{niv} · arrastra=girar · clic con herramienta=dibujar/borrar</div>
              </div>
              <SvgGrilla3D ordsX={ordsPreview.x} ordsY={ordsPreview.y} niveles={nivelesPreview} width={1090} height={400}
                nivelSelZ={nivelesPreview[niv]} elementos={dibujoElementos} vistas selId={modSel}
                interactivo
                toolModo={modTool === 'borrar' ? 'borrar' : ['columna', 'viga', 'muro', 'polilinea', 'losa'].includes(modTool) ? 'draw' : null}
                planoZ={nivelesPreview[niv]}
                onWorldClick={(x, y) => colocar({ x, y, tipo: 'coord' })}
                onDeleteEl={(id) => { setDibujoElementos(prev => prev.filter(e => e.id !== id)); if (modSel === id) setModSel(null); }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ----- Vista de RESULTADOS (v3.0): chequeos E.030 con semaforos -----
  const renderResultados = () => {
    const cardCls = 'bg-white/[0.025] border border-white/[0.07] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.35)]';
    const tituloCls = 'text-[10px] font-black text-cyan-300 uppercase tracking-widest mb-2';
    const thCls = 'text-left text-[8.5px] text-slate-500 font-black uppercase px-2 py-1';
    const tdCls = 'text-[9.5px] text-slate-300 font-mono px-2 py-0.5';
    const chequeos = resData?.chequeos || {};
    const semaforo = (ok) => (
      <span className={`inline-block w-2.5 h-2.5 rounded-full mr-2 ${ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-red-500 shadow-[0_0_8px_rgba(248,113,113,0.8)]'}`}></span>
    );
    return (
      <div className="flex-grow overflow-auto p-6">
        <div className="mx-auto" style={{ width: 1160 }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">📊 Resultados y chequeos E.030</h2>
              <p className="text-[9px] text-slate-500 mt-1">Leidos del modelo ANALIZADO en ETABS (unidades: {resData?.unidades || 'kgf, m'}). Ejecuta primero el paso 17 · Analizar.</p>
            </div>
            <button onClick={handleLeerResultados} disabled={resLoading} className="bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 disabled:from-slate-800 disabled:to-slate-800 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20 transition-all">{resLoading ? 'Leyendo...' : '📡 Leer resultados'}</button>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-4 items-end">
            <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Casos de deriva (coma)</label><input value={resParams.derivas} onChange={e => setRes('derivas', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Limite de deriva</label><input type="number" step="0.001" value={resParams.limite} onChange={e => setRes('limite', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Cortante basal de (coma)</label><input value={resParams.cortantes} onChange={e => setRes('cortantes', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Caso modal</label><input value={resParams.modal} onChange={e => setRes('modal', e.target.value)} className={inputCls} /></div>
            <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Desplazam. por piso (coma)</label><input value={resParams.desplaz} onChange={e => setRes('desplaz', e.target.value)} className={inputCls} /></div>
          </div>

          {resError && (
            <div className="bg-red-950/60 border border-red-500/30 text-red-200 text-[10px] font-bold rounded-2xl px-4 py-3 mb-4">
              {resError}
              {resError.includes('no esta analizado') && <span className="block mt-1 text-red-300/80 font-normal">Abre el paso 17 · Analizar del flujo de trabajo y ejecutalo.</span>}
            </div>
          )}

          {!resData && !resError && (
            <div className="border border-dashed border-white/10 rounded-2xl p-10 text-center text-[11px] text-slate-500">
              Analiza el modelo (paso 17 del flujo) y pulsa <span className="text-cyan-300 font-bold">Leer resultados</span> para ver los chequeos E.030: masa participativa ≥ 90%, derivas ≤ limite, cortantes y periodos.
            </div>
          )}

          {resData && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className={`${cardCls} ${chequeos.masa_90?.cumple ? 'ring-1 ring-emerald-500/30' : 'ring-1 ring-red-500/40'}`}>
                  <div className={tituloCls}>{semaforo(chequeos.masa_90?.cumple)}Masa participativa (E.030: ≥ 90%)</div>
                  <div className={`text-[13px] font-black ${chequeos.masa_90?.cumple ? 'text-emerald-300' : 'text-red-300'}`}>{chequeos.masa_90?.cumple ? 'CUMPLE' : 'NO CUMPLE'}</div>
                  <div className="text-[9.5px] text-slate-400 mt-1">{chequeos.masa_90?.detalle}</div>
                  {resData.modal?.T1 != null && <div className="text-[9.5px] text-slate-500 mt-1">Periodo fundamental T1 = <span className="text-cyan-300 font-bold">{Number(resData.modal.T1).toFixed(4)} s</span> · {resData.modal.modos} modos ({resData.modal.caso})</div>}
                </div>
                <div className={`${cardCls} ${chequeos.derivas?.cumple ? 'ring-1 ring-emerald-500/30' : 'ring-1 ring-red-500/40'}`}>
                  <div className={tituloCls}>{semaforo(chequeos.derivas?.cumple)}Derivas de entrepiso (limite {resData.derivas?.limite})</div>
                  <div className={`text-[13px] font-black ${chequeos.derivas?.cumple ? 'text-emerald-300' : 'text-red-300'}`}>{chequeos.derivas?.cumple ? 'CUMPLE' : 'NO CUMPLE'}</div>
                  <div className="text-[9.5px] text-slate-400 mt-1">{chequeos.derivas?.detalle}</div>
                  {Boolean(resData.derivas?.no_encontrados?.length) && <div className="text-[9px] text-amber-300 mt-1">No encontrados: {resData.derivas.no_encontrados.join(', ')} (revisa los nombres)</div>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className={cardCls}>
                  <div className={tituloCls}>Derivas por piso (Story Drifts)</div>
                  <SvgDerivasPerfil perfil={resData.derivas?.perfil} baseZ={Number(resData.derivas?.base_z) || 0} limite={Number(resData.derivas?.limite) || 0.007} />
                  <div className="max-h-56 overflow-y-auto mt-2">
                    <table className="w-full">
                      <thead><tr><th className={thCls}>Piso</th><th className={thCls}>Caso</th><th className={thCls}>Dir</th><th className={thCls}>Deriva</th><th className={thCls}>Chequeo</th></tr></thead>
                      <tbody>
                        {(resData.derivas?.filas || []).map((f, i) => (
                          <tr key={i} className="odd:bg-white/[0.02]">
                            <td className={tdCls}>{f.piso}</td><td className={tdCls}>{f.caso}</td><td className={tdCls}>{f.direccion}</td>
                            <td className={tdCls}>{Number(f.deriva).toFixed(5)}</td>
                            <td className={`${tdCls} font-black ${f.cumple ? 'text-emerald-400' : 'text-red-400'}`}>{f.cumple ? 'OK' : 'EXCEDE'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className={cardCls}>
                    <div className={tituloCls}>Modal: periodos y masa participativa</div>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full">
                        <thead><tr><th className={thCls}>Modo</th><th className={thCls}>T (s)</th><th className={thCls}>UX</th><th className={thCls}>UY</th><th className={thCls}>ΣUX</th><th className={thCls}>ΣUY</th></tr></thead>
                        <tbody>
                          {(resData.modal?.tabla || []).map(m => (
                            <tr key={m.modo} className="odd:bg-white/[0.02]">
                              <td className={tdCls}>{m.modo}</td><td className={tdCls}>{Number(m.T).toFixed(4)}</td>
                              <td className={tdCls}>{(m.UX * 100).toFixed(1)}%</td><td className={tdCls}>{(m.UY * 100).toFixed(1)}%</td>
                              <td className={`${tdCls} ${m.sumUX >= 0.9 ? 'text-emerald-400' : ''}`}>{(m.sumUX * 100).toFixed(1)}%</td>
                              <td className={`${tdCls} ${m.sumUY >= 0.9 ? 'text-emerald-400' : ''}`}>{(m.sumUY * 100).toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className={cardCls}>
                    <div className={tituloCls}>Cortante basal y peso (kgf)</div>
                    <table className="w-full">
                      <thead><tr><th className={thCls}>Caso</th><th className={thCls}>FX</th><th className={thCls}>FY</th><th className={thCls}>FZ (peso)</th></tr></thead>
                      <tbody>
                        {Object.entries(resData.cortante_basal || {}).map(([caso, v]) => (
                          <tr key={caso} className="odd:bg-white/[0.02]">
                            <td className={`${tdCls} font-bold text-slate-200`}>{caso}</td>
                            <td className={tdCls}>{Number(v.FX).toLocaleString()}</td>
                            <td className={tdCls}>{Number(v.FY).toLocaleString()}</td>
                            <td className={tdCls}>{Number(v.FZ).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-[8.5px] text-slate-600 mt-2">Estado de casos: {Object.entries(resData.estado_casos || {}).map(([c, e]) => `${c}: ${e}`).join(' · ')}</div>
                  </div>
                </div>
              </div>

              <div className={`${cardCls} mt-4`}>
                <div className={tituloCls}>Desplazamientos maximos por piso (Story Response · mm)</div>
                {resData.desplazamientos_error
                  ? <div className="text-[10px] text-amber-300">No se pudieron leer: {resData.desplazamientos_error}</div>
                  : (
                    <>
                      <SvgDesplazamientos desplaz={resData.desplazamientos} />
                      {Boolean(resData.desplazamientos?.no_encontrados?.length) && <div className="text-[9px] text-amber-300 mt-1">No encontrados: {resData.desplazamientos.no_encontrados.join(', ')} (revisa los nombres)</div>}
                      <div className="max-h-56 overflow-y-auto mt-2">
                        <table className="w-full">
                          <thead><tr><th className={thCls}>Caso</th><th className={thCls}>Piso</th><th className={thCls}>Ux (mm)</th><th className={thCls}>Uy (mm)</th></tr></thead>
                          <tbody>
                            {Object.entries(resData.desplazamientos?.por_caso || {}).flatMap(([caso, filas]) =>
                              [...filas].reverse().map((f, i) => (
                                <tr key={caso + i} className="odd:bg-white/[0.02]">
                                  <td className={`${tdCls} font-bold text-slate-200`}>{i === 0 ? caso : ''}</td>
                                  <td className={tdCls}>{f.piso}</td>
                                  <td className={tdCls}>{Number(f.ux).toFixed(2)}</td>
                                  <td className={tdCls}>{Number(f.uy).toFixed(2)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
              </div>
            </>
          )}

          <div className={`${cardCls} mt-4`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div>
                <div className={tituloCls} style={{ marginBottom: 0 }}>🔬 Verificación cruzada con OpenSees (opcional)</div>
                <p className="text-[9px] text-slate-500 mt-1">Modelo elástico 3D equivalente (pórticos en toda la grilla, diafragma rígido) corrido en OpenSees con el espectro E.030. Contrasta T, masa, cortante y derivas contra ETABS — una segunda opinión gratis, sin licencia.</p>
              </div>
              <button onClick={verificarOpenSees} disabled={osLoading} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-slate-800 disabled:to-slate-800 px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-violet-500/20 transition-all">{osLoading ? 'Corriendo OpenSees…' : '🔬 Verificar con OpenSees'}</button>
            </div>
            {(() => {
              const meta = (buildOpenSeesSpec() || {})._meta;
              return (
                <div className="grid grid-cols-4 gap-3 mb-3 items-end">
                  <div className="col-span-3 bg-black/30 border border-white/5 rounded-xl px-3 py-2">
                    <div className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">Datos usados (de tu flujo · los mismos que van a ETABS)</div>
                    {meta ? (
                      <div className="text-[9.5px] text-slate-300 leading-relaxed">
                        <b className="text-cyan-300">f&apos;c</b> {meta.fc} kgf/cm² · <b className="text-cyan-300">Columna</b> {meta.colSec} cm · <b className="text-cyan-300">Viga</b> {meta.vigaSec} cm · <b className="text-cyan-300">Losa</b> {meta.losa} ({meta.slabW} kgf/m²)<br />
                        <b className="text-cyan-300">Cargas</b> {meta.cargas} · <b className="text-cyan-300">Grilla</b> {meta.nejes} ejes · {meta.npisos} pisos · <b className="text-cyan-300">masa/piso</b> ≈ {Number(meta.masaPiso).toFixed(1)} ton ({Number(meta.masaTot).toFixed(0)} ton total)
                      </div>
                    ) : <div className="text-[9.5px] text-amber-300/80">Define la grilla y los pisos (o usa &quot;Leer de ETABS&quot; en el Modelador) para armar el modelo.</div>}
                  </div>
                  <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1"># modos</label><input type="number" value={osParams.nmodes} onChange={e => setOs('nmodes', e.target.value)} className={inputCls} /></div>
                  <div className="col-span-4">
                    <label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Modelo de losa</label>
                    <select value={osParams.modeloLosa || 'diafragma'} onChange={e => setOs('modeloLosa', e.target.value)} className={inputCls}>
                      <option value="diafragma">Membrana = diafragma rígido (sin elemento de área · modelo fiel)</option>
                      <option value="shell">Cáscara ShellMITC4 real (la ves en el conteo · añade rigidez ≈ shell-thin)</option>
                    </select>
                    <div className="text-[8px] text-slate-600 mt-1 leading-snug">En OpenSees 3D no hay un elemento de área "solo membrana": la membrana fiel ES el diafragma rígido (sin elemento). El ShellMITC4 trae rigidez de placa, así que rigidiza el modelo (T1 baja) ≈ comportamiento shell-thin.</div>
                  </div>
                </div>
              );
            })()}
            {osError && <div className="bg-red-950/60 border border-red-500/30 text-red-200 text-[10px] font-bold rounded-xl px-4 py-2.5 mb-3">{osError}</div>}
            {osData && (() => {
              const m = osData._meta || {};
              const os = {
                T1: Number(osData.T1),
                mx: Number(osData.modal?.masa_x_pct), my: Number(osData.modal?.masa_y_pct),
                vx: Number(osData.espectral?.cortante_basal_x_kN) / 9.81,
                vy: Number(osData.espectral?.cortante_basal_y_kN) / 9.81,
                drx: Number(osData.espectral?.deriva_max_x), dry: Number(osData.espectral?.deriva_max_y),
              };
              // E.030: deriva inelastica = (0.75R regular / 0.85R irregular), R=R0*Ia*Ip por
              // direccion. Se usa el MISMO factor que ETABS (comboParams.factorDerivaX/Y).
              const ddR = calcEspectroDiseno(disenoEspectro);
              const esIrr = ddR.Iax < 1 || ddR.Iay < 1 || ddR.Ipx < 1 || ddR.Ipy < 1;
              const facR = esIrr ? 0.85 : 0.75;
              const ampX = Number(comboParams.factorDerivaX) || facR * ddR.Rx;
              const ampY = Number(comboParams.factorDerivaY) || facR * ddR.Ry;
              const cb = resData?.cortante_basal || {};
              const buscaCb = subs => { for (const k of Object.keys(cb)) if (subs.some(s => k.toUpperCase().includes(s))) return Math.abs(Number(cb[k])); return null; };
              const filas = resData?.derivas?.filas || [];
              const drDir = letra => { const v = filas.filter(f => (f.direccion || '').toUpperCase().includes(letra)).map(f => Number(f.deriva) || 0); return v.length ? Math.max(...v) : null; };
              const et = resData ? {
                T1: resData.modal?.T1 != null ? Number(resData.modal.T1) : null,
                vx: (() => { const k = buscaCb(['CSX']) ?? buscaCb(['SX']); return k != null ? k / 1000 : null; })(),
                vy: (() => { const k = buscaCb(['CSY']) ?? buscaCb(['SY']); return k != null ? k / 1000 : null; })(),
                drx: drDir('X'), dry: drDir('Y'),
              } : null;
              const fmt = (v, d = 2) => (v == null || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
              const delta = (o, e) => (e == null || !e || o == null || Number.isNaN(o)) ? '—' : `${(o - e) / e * 100 >= 0 ? '+' : ''}${((o - e) / e * 100).toFixed(1)}%`;
              const row = (lbl, o, e, d = 2, nota) => (
                <tr className="odd:bg-white/[0.02]">
                  <td className="text-[9.5px] text-slate-300 px-2 py-1 font-bold">{lbl}{nota && <span className="text-slate-500 font-normal"> {nota}</span>}</td>
                  <td className="text-[9.5px] text-cyan-200 font-mono px-2 py-1 text-right">{fmt(e, d)}</td>
                  <td className="text-[9.5px] text-fuchsia-200 font-mono px-2 py-1 text-right">{fmt(o, d)}</td>
                  <td className="text-[9.5px] text-slate-400 font-mono px-2 py-1 text-right">{delta(o, e)}</td>
                </tr>
              );
              return (
                <>
                  <div className="text-[9px] text-slate-500 mb-2">Modelo OpenSees: {m.nejes} ejes · {m.npisos} pisos · masa {fmt(osData.masa_total_ton, 0)} ton · área {fmt(m.area, 0)} m². {!resData && <span className="text-amber-300/80">Lee los resultados de ETABS (botón arriba) para comparar las columnas.</span>}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        <th className="text-left text-[8.5px] text-slate-500 font-black uppercase px-2 py-1">Parámetro</th>
                        <th className="text-right text-[8.5px] text-cyan-400 font-black uppercase px-2 py-1">ETABS</th>
                        <th className="text-right text-[8.5px] text-fuchsia-400 font-black uppercase px-2 py-1">OpenSees</th>
                        <th className="text-right text-[8.5px] text-slate-500 font-black uppercase px-2 py-1">Δ</th>
                      </tr></thead>
                      <tbody>
                        {row('T₁ (s)', os.T1, et?.T1, 3)}
                        {row('Masa particip. X (%)', os.mx, null, 1)}
                        {row('Masa particip. Y (%)', os.my, null, 1)}
                        {row('Cortante basal X (tonf)', os.vx, et?.vx, 1)}
                        {row('Cortante basal Y (tonf)', os.vy, et?.vy, 1)}
                        {row('Deriva máx X', os.drx * ampX, et?.drx, 5, `(OS ×${ampX.toFixed(2)})`)}
                        {row('Deriva máx Y', os.dry * ampY, et?.dry, 5, `(OS ×${ampY.toFixed(2)})`)}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[8.5px] text-slate-600 mt-2">Notas: la deriva de OpenSees es <b className="text-slate-400">elástica</b>; se amplifica ×{ampX.toFixed(2)} (X) / ×{ampY.toFixed(2)} (Y) ({esIrr ? '0.85·R irregular' : '0.75·R regular'}, R=R₀·Ia·Ip por dirección) para comparar con DERVX/Y de ETABS. Cortantes en tonf. El detalle dato a dato y la verificación del factor están en la pestaña 🔧 OpenSees.</p>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // ----- Vista de MEMORIA DE CALCULO (materiales o espectro): LaTeX + KaTeX -----
  const setMem = (field, value) => setMemoriaParams(prev => ({ ...prev, [field]: value }));
  const setDes = (field, value) => setDesarrolloParams(prev => ({ ...prev, [field]: value }));
  const setFlx = (field, value) => setFlexionParams(prev => ({ ...prev, [field]: value }));
  const setDist = (field, value) => setDistribParams(prev => ({ ...prev, [field]: value }));
  const memoria = useMemo(() => buildMemoriaMateriales(memoriaParams), [memoriaParams]);
  const memoriaEsp = useMemo(() => buildMemoriaEspectro(disenoEspectro, memoriaParams, proyecto), [disenoEspectro, memoriaParams, proyecto]);
  const memoriaDes = useMemo(() => buildMemoriaDesarrollo(desarrolloParams, proyecto, memoriaParams), [desarrolloParams, proyecto, memoriaParams]);
  const memoriaFlx = useMemo(() => buildMemoriaFlexion(flexionParams, proyecto, memoriaParams), [flexionParams, proyecto, memoriaParams]);
  const memoriaDist = useMemo(() => buildMemoriaDistribucion(distribParams, proyecto, memoriaParams), [distribParams, proyecto, memoriaParams]);
  // Documento activo (materiales | espectro | desarrollo | flexion | distrib): de aqui salen el .tex y el nombre.
  const memoDoc = memoriaTipo === 'espectro' ? memoriaEsp : memoriaTipo === 'desarrollo' ? memoriaDes : memoriaTipo === 'flexion' ? memoriaFlx : memoriaTipo === 'distrib' ? memoriaDist : memoria;
  const memoFile = memoriaTipo === 'espectro' ? 'memoria_espectro_E030' : memoriaTipo === 'desarrollo' ? 'memoria_longitud_desarrollo' : memoriaTipo === 'flexion' ? 'memoria_flexion_vigas' : memoriaTipo === 'distrib' ? 'memoria_distribucion_refuerzo' : `memoria_materiales_${memoriaParams.norma}`;

  const handleCopiarLatex = async () => {
    try {
      await navigator.clipboard.writeText(memoDoc.latex);
      showStatus('success', 'Codigo LaTeX copiado. Pegalo en Overleaf y compila.');
    } catch {
      const a = document.createElement('textarea'); a.value = memoDoc.latex; document.body.appendChild(a); a.select(); document.execCommand('copy'); document.body.removeChild(a);
      showStatus('success', 'Codigo LaTeX copiado.');
    }
  };
  const handleDescargarTex = () => {
    const blob = new Blob([memoDoc.latex], { type: 'text/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${memoFile}.tex`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    showStatus('success', `${memoFile}.tex descargado.`);
  };
  const handleExportarPdf = () => {
    // La hoja A4 se aisla con el CSS @media print; el dialogo del navegador
    // permite "Guardar como PDF" (vectorial, formulas nitidas).
    showStatus('success', 'En el dialogo elige "Guardar como PDF" y destino A4.');
    setTimeout(() => window.print(), 250);
  };

  // Hoja A4 del documento del ESPECTRO DE RESPUESTA (E.030-2026), estilo ANEXO 2
  // de la hoja del usuario. Lee disenoEspectro (la misma fuente del paso Espectro).
  const renderHojaEspectro = () => {
    const dE = calcEspectroDiseno(disenoEspectro);
    const tblFactores = (
      <div className="esp-grid2">
        <div>
          <div className="esp-cap">Tabla N°1 — Factor de zona &quot;Z&quot;</div>
          <table className="esp-tbl"><thead><tr><th>ZONA</th><th>Z</th></tr></thead>
            <tbody><tr><td>{dE.zona.nombre}</td><td>{dE.Z}</td></tr></tbody></table>
          <div className="esp-cap">Tabla N°7 — Factor de uso &quot;U&quot;</div>
          <table className="esp-tbl"><thead><tr><th>CATEGORÍA</th><th>U</th></tr></thead>
            <tbody><tr><td style={{ textAlign: 'left' }}>{dE.uso.nombre}</td><td>{dE.U}</td></tr></tbody></table>
        </div>
        <div>
          <div className="esp-cap">Tablas N°4 y N°5 — Factor de suelo &quot;S&quot;</div>
          <table className="esp-tbl"><thead><tr><th>TIPO</th><th>S</th><th>T<sub>P</sub></th><th>T<sub>L</sub></th></tr></thead>
            <tbody><tr><td>{dE.suelo.id}</td><td>{dE.S}</td><td>{dE.TP}</td><td>{dE.TL}</td></tr></tbody></table>
          <div className="esp-cap">Factor de sistema estructural &quot;R&quot;</div>
          <table className="esp-tbl"><thead><tr><th>DIRECCIÓN</th><th>SISTEMA</th><th>R<sub>0</sub></th></tr></thead>
            <tbody>
              <tr><td>X-X</td><td style={{ textAlign: 'left' }}>{dE.sisX.nombre}</td><td>{dE.R0x}</td></tr>
              <tr><td>Y-Y</td><td style={{ textAlign: 'left' }}>{dE.sisY.nombre}</td><td>{dE.R0y}</td></tr>
            </tbody></table>
        </div>
      </div>
    );
    const tIrr = (base, arrX, arrY, resX, resY, tit, sym) => (
      <table className="esp-tbl"><thead>
        <tr><th style={{ textAlign: 'left', width: '50%' }}>{tit}</th><th>Dir X-X</th><th>Dir Y-Y</th><th>{sym} X-X</th><th>{sym} Y-Y</th></tr>
      </thead><tbody>
        {base.map(it => {
          const x = (arrX || []).includes(it.id), y = (arrY || []).includes(it.id);
          return (<tr key={it.id}><td style={{ textAlign: 'left' }}>{it.nombre}</td>
            <td>{x ? '☑' : '☐'}</td><td>{y ? '☑' : '☐'}</td>
            <td>{(x ? it.f : 1).toFixed(2)}</td><td>{(y ? it.f : 1).toFixed(2)}</td></tr>);
        })}
        <tr style={{ fontWeight: 'bold', background: '#f6f6f6' }}>
          <td style={{ textAlign: 'left' }}>Se toma el valor más crítico</td><td></td><td></td>
          <td>{resX.toFixed(2)}</td><td>{resY.toFixed(2)}</td></tr>
      </tbody></table>
    );
    const halfSa = pts => (
      <table className="esp-sa"><thead><tr><th>C</th><th>T (s)</th><th>Sa X-X</th><th>Sa Y-Y</th></tr></thead>
        <tbody>{pts.map((p, i) => (<tr key={i}><td>{p.c.toFixed(2)}</td><td>{p.t.toFixed(2)}</td><td>{p.sax.toFixed(3)}</td><td>{p.say.toFixed(3)}</td></tr>))}</tbody></table>
    );
    const mid = Math.ceil(dE.puntos.length / 2);
    // Encabezado/pie reutilizables: cada hoja A4 del documento (multipágina) los repite.
    const header = () => (
      <div className="mem-header">
        <div className="izq">{memoriaParams.encabezadoIzq || ' '}</div>
        <div className="der">{memoriaParams.encabezadoDer}</div>
      </div>
    );
    const pie = (n, tot) => (
      <div className="mem-pie">Memoria del espectro de respuesta · Norma E.030-2026 — Página {n} de {tot}</div>
    );
    const titulo = (
      <div className="text-center" style={{ marginBottom: '4mm' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', letterSpacing: '0.01em' }}>ANEXO 2: CÁLCULO DE ESPECTRO DE PSEUDO - ACELERACIONES (NORMA E.030-2026)</div>
        <div style={{ fontSize: '10pt', marginTop: '1.5mm' }}><b>Proyecto:</b> {proyecto || '—'}</div>
        <div style={{ borderBottom: '0.6pt solid #1a1a1a', marginTop: '2.5mm' }}></div>
      </div>
    );
    if (!dE.valido) {
      return (
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          {titulo}
          <div style={{ color: '#a15d00', fontWeight: 'bold', padding: '14mm 0', textAlign: 'center' }}>
            El suelo {dE.suelo.id} no está tabulado para la {dE.zona.nombre}: requiere un estudio de sitio (EMS).<br />
            Ajusta zona/suelo en la pestaña 📈 El Espectro de Diseño.
          </div>
          {pie(1, 1)}
        </div>
      );
    }
    return (
      <>
        {/* PÁGINA 1 (A4) — factores sísmicos + irregularidades */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          {titulo}
          <div className="esp-sec">1. Factores sísmicos</div>
          {tblFactores}
          <div className="esp-sec">2. Irregularidades estructurales</div>
          <div className="esp-cap">En altura (I<sub>a</sub>) — Tabla N°10</div>
          {tIrr(IRREG_ALTURA, disenoEspectro.iaX, disenoEspectro.iaY, dE.Iax, dE.Iay, 'Irregularidad estructural en altura', 'Ia')}
          <div className="esp-cap" style={{ marginTop: '3mm' }}>En planta (I<sub>p</sub>) — Tabla N°10</div>
          {tIrr(IRREG_PLANTA, disenoEspectro.ipX, disenoEspectro.ipY, dE.Ipx, dE.Ipy, 'Irregularidad estructural en planta', 'Ip')}
          {pie(1, 3)}
        </div>
        {/* PÁGINA 2 (A4) — resumen + gráficos del espectro */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="esp-sec">3. Resumen y espectro de diseño</div>
          <div className="esp-resumen">
            <table className="esp-tbl" style={{ width: 'auto' }}><thead><tr><th>DATO</th><th>VALOR</th></tr></thead>
              <tbody>
                <tr><td>Z</td><td>{dE.Z}</td></tr><tr><td>U</td><td>{dE.U}</td></tr>
                <tr><td>S</td><td>{dE.S}</td></tr><tr><td>T<sub>P</sub></td><td>{dE.TP}</td></tr><tr><td>T<sub>L</sub></td><td>{dE.TL}</td></tr>
              </tbody></table>
            <table className="esp-tbl" style={{ width: 'auto' }}><thead><tr><th>FACTOR</th><th>Dir X-X</th><th>Dir Y-Y</th></tr></thead>
              <tbody>
                <tr><td>R<sub>0</sub></td><td>{dE.R0x}</td><td>{dE.R0y}</td></tr>
                <tr><td>I<sub>a</sub></td><td>{dE.Iax.toFixed(2)}</td><td>{dE.Iay.toFixed(2)}</td></tr>
                <tr><td>I<sub>p</sub></td><td>{dE.Ipx.toFixed(2)}</td><td>{dE.Ipy.toFixed(2)}</td></tr>
                <tr style={{ fontWeight: 'bold' }}><td>R</td><td>{dE.Rx.toFixed(2)}</td><td>{dE.Ry.toFixed(2)}</td></tr>
                <tr><td>g</td><td colSpan={2}>{dE.g === 1 ? '1 (Sa/g)' : '9.81 m/s²'}</td></tr>
              </tbody></table>
            <div className="esp-formula">
              <span dangerouslySetInnerHTML={{ __html: tex('S_a = \\dfrac{Z\\,U\\,C\\,S}{R}\\,g', true) }} />
              <span dangerouslySetInnerHTML={{ __html: tex('R = R_0\\cdot I_a\\cdot I_p', true) }} />
            </div>
          </div>
          <div className="esp-charts">
            <SvgEspectroDoc datos={dE} dir="x" width={330} />
            <SvgEspectroDoc datos={dE} dir="y" width={330} />
          </div>
          {pie(2, 3)}
        </div>
        {/* PÁGINA 3 (A4) — tabla T-Sa de pseudo-aceleraciones */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="esp-sec">4. Tabla T – Sa (pseudo-aceleraciones)</div>
          <div className="esp-grid2">{halfSa(dE.puntos.slice(0, mid))}{halfSa(dE.puntos.slice(mid))}</div>
          {pie(3, 3)}
        </div>
      </>
    );
  };

  // Hoja(s) A4 de la memoria de LONGITUD DE DESARROLLO A TRACCION (E.060/ACI),
  // estilo Mathcad. Lee desarrolloParams; encabezado de memoriaParams. 2 paginas.
  const renderHojaDesarrollo = () => {
    const d = calcDesarrollo(desarrolloParams);
    const f3 = x => x.toFixed(3), f2 = x => x.toFixed(2);
    const AZ = '#1d4ed8';
    const U2 = `\\;\\textcolor{${AZ}}{\\mathbf{\\dfrac{kgf}{cm^{2}}}}`;
    const UCM = `\\;\\textcolor{${AZ}}{\\mathbf{cm}}`;
    const UCM2 = `\\;\\textcolor{${AZ}}{\\mathbf{cm^{2}}}`;
    const header = () => (
      <div className="mem-header">
        <div className="izq">{memoriaParams.encabezadoIzq || ' '}</div>
        <div className="der">{memoriaParams.encabezadoDer}</div>
      </div>
    );
    const pie = (n, tot) => (<div className="mem-pie">Longitud de desarrollo a tracción · E.060 / ACI 318-19 — Página {n} de {tot}</div>);
    const filaIn = (t, desc) => (
      <div className="mem-fila"><div className="mem-eq"><span className="mem-inbox" dangerouslySetInnerHTML={{ __html: tex(t) }} /></div><div className="mem-desc">{desc}</div></div>
    );
    const filaC = (t, desc) => (
      <div className="mem-fila mem-eqc"><div style={{ flex: '1' }}><span dangerouslySetInnerHTML={{ __html: tex(t) }} /></div><div style={{ flex: '0 0 auto', maxWidth: '60mm', fontStyle: 'italic', color: '#555', textAlign: 'right' }}>{desc}</div></div>
    );
    const tabla90 = (
      <table className="esp-tbl"><thead>
        <tr><th colSpan={3}>Gancho estándar a 90°</th></tr>
        <tr><th>Barra (d<sub>b</sub>)</th><th>12 d<sub>b</sub> (mm)</th><th>L (mm)</th></tr>
      </thead><tbody>
        {d.tabla.map(t => <tr key={t.label}><td>{t.label}</td><td>{t.ext90}</td><td>{t.l90}</td></tr>)}
      </tbody></table>
    );
    const tabla180 = (
      <table className="esp-tbl"><thead>
        <tr><th colSpan={3}>Gancho estándar a 180°</th></tr>
        <tr><th>Barra (d<sub>b</sub>)</th><th>4 d<sub>b</sub> (mm)</th><th>L (mm)</th></tr>
      </thead><tbody>
        {d.tabla.map(t => <tr key={t.label}><td>{t.label}</td><td>{t.ext180}</td><td>{t.l180}</td></tr>)}
      </tbody></table>
    );
    const titulo = (
      <div className="text-center" style={{ marginBottom: '5mm' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', letterSpacing: '0.01em' }}>LONGITUD DE DESARROLLO A TRACCIÓN (NORMA E.060 / ACI 318-19)</div>
        <div style={{ fontSize: '10pt', marginTop: '1.5mm' }}><b>Proyecto:</b> {proyecto || '—'}</div>
        <div style={{ borderBottom: '0.6pt solid #1a1a1a', marginTop: '2.5mm' }}></div>
      </div>
    );
    return (
      <>
        {/* PÁGINA 1 (A4) — datos + longitud de desarrollo */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          {titulo}
          <div className="mem-head">1. Datos</div>
          {filaIn(`f'_c := ${Math.round(d.FC)}${U2}`, 'Resistencia a compresión del concreto')}
          {filaIn(`f_y := ${Math.round(d.FY)}${U2}`, 'Esfuerzo de fluencia del acero')}
          {filaIn(`d_b := ${f3(d.db)}${UCM}`, `Diámetro de la varilla (${d.barra})`)}
          {filaIn(`\\lambda := ${f2(d.lam)}`, '1 concreto normal · 0.75 concreto ligero')}
          {filaIn(`\\psi_t := ${f2(d.psiT)}`, 'Factor de posición (1.3 barra superior)')}
          {filaIn(`\\psi_e := ${f2(d.psiE)}`, 'Factor de recubrimiento / epóxico')}
          {filaIn(`\\psi_g := ${f2(d.psiG)}`, 'Factor de grado del refuerzo')}
          {filaIn(`\\psi_s := ${f2(d.psiS)}`, 'Factor de tamaño (0.8 para 3/4" o menos)')}
          {filaIn(`r := ${f2(d.r)}${UCM}`, 'Recubrimiento libre de la viga')}
          {filaIn(`d_t := ${f3(d.dt)}${UCM}`, `Diámetro del estribo (${d.estribo})`)}
          {filaIn(`s := ${f2(d.s)}${UCM}`, 'Separación centro a centro de estribos')}
          {filaIn(`n := ${Math.round(d.n)}`, 'Número de barras longitudinales por capa')}
          <div className="mem-head">2. Cálculos</div>
          {filaC(`c_b := r + d_t + \\tfrac{d_b}{2} = ${f3(d.cb)}${UCM}`, 'Separación / dimensión del recubrimiento')}
          {filaC(`A_{tr} := 2\\left(\\dfrac{\\pi\\,d_t^{2}}{4}\\right) = ${f3(d.Atr)}${UCM2}`, 'Área del refuerzo por cortante')}
          {filaC(`K_{tr} := \\dfrac{A_{tr}\\,f_y}{105\\,s\\,n} = ${f2(d.Ktr)}`, 'E.060 Fórmula 12-2 · ACI 25.4.2.4b')}
          {filaC(`l_d := \\begin{cases} \\dfrac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s}{8.2\\,\\lambda\\sqrt{f'_c}}\\,d_b & d_b \\le 1.91 \\\\[8pt] \\dfrac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s}{6.6\\,\\lambda\\sqrt{f'_c}}\\,d_b & d_b > 1.91 \\end{cases} = ${f3(d.ldSimple)}${UCM}`, 'Simplificada · E.060 Tabla 12.1 (ACI 25.4.2.3: 6.6 / 5.3)')}
          {filaC(`l_d := \\dfrac{f_y\\,\\psi_t\\,\\psi_e\\,\\psi_s\\,\\psi_g}{3.5\\,\\lambda\\sqrt{f'_c}\\;\\min\\!\\left(\\dfrac{c_b+K_{tr}}{d_b},\\,2.5\\right)}\\,d_b = ${f3(d.ldGeneral)}${UCM}`, 'General · E.060 Fórmula 12-1 · ACI 25.4.2.4a')}
          {pie(1, 3)}
        </div>
        {/* PÁGINA 2 (A4) — concepto del anclaje + desarrollo de ganchos */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">3. Anclaje del refuerzo a tracción</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '2mm 0 1mm' }}><div style={{ width: '150mm' }}><SvgVigaConcepto width={460} /></div></div>
          <div style={{ fontSize: '8.5pt', color: '#555', textAlign: 'center', marginBottom: '3mm' }}>El refuerzo debe prolongarse una longitud de desarrollo ℓd a cada lado de toda sección crítica.</div>
          <div className="mem-head">4. Desarrollo de ganchos estándar a tracción</div>
          {filaC(`l_{dh} := \\dfrac{0.075\\,\\psi_e\\,f_y}{\\lambda\\sqrt{f'_c}}\\,d_b = ${f3(d.ldh)}${UCM}`, 'Longitud de desarrollo del gancho (E.060 12.5 / ACI 25.4.3)')}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '2mm 0' }}><div style={{ width: '130mm' }}><SvgAnclajeGancho width={430} /></div></div>
          {pie(2, 3)}
        </div>
        {/* PÁGINA 3 (A4) — ganchos estándar: geometría + tablas */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">5. Ganchos estándar (fórmulas hasta diámetros de 1")</div>
          {filaC(`L_{90} := d_b + 3\\,d_b + 12\\,d_b = ${f2(d.L90)}${UCM}`, 'Doblez a 90° (extensión 12 d_b)')}
          {filaC(`L_{180} := d_b + 3\\,d_b + 4\\,d_b = ${f2(d.L180)}${UCM}`, 'Doblez a 180° (extensión 4 d_b, mín. 65 mm)')}
          <div className="esp-grid2" style={{ marginTop: '3mm', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, textAlign: 'center' }}><SvgGanchoDetalle tipo="90" width={230} />{tabla90}</div>
            <div style={{ flex: 1, textAlign: 'center' }}><SvgGanchoDetalle tipo="180" width={230} />{tabla180}</div>
          </div>
          {pie(3, 3)}
        </div>
      </>
    );
  };

  // Hoja(s) A4 de la memoria de DISEÑO DE FLEXIÓN DE VIGAS (ACI 318-19), 5 páginas.
  const renderHojaFlexion = () => {
    const d = calcFlexion(flexionParams);
    const f2 = x => (Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100).toFixed(2), f4 = x => x.toFixed(4);
    const fm = x => Number.isInteger(x) ? String(x) : x.toFixed(2);
    const pp = x => String(Math.round(x * 100 * 100) / 100);
    const AZ = '#1d4ed8';
    const U = `\\;\\textcolor{${AZ}}{\\mathbf{cm}}`;
    const U2 = `\\;\\textcolor{${AZ}}{\\mathbf{cm^{2}}}`;
    const UK = `\\;\\textcolor{${AZ}}{\\mathbf{\\dfrac{kgf}{cm^{2}}}}`;
    const UKC = `\\;\\textcolor{${AZ}}{\\mathbf{kgf\\!\\cdot\\!cm}}`;
    const header = () => (
      <div className="mem-header"><div className="izq">{memoriaParams.encabezadoIzq || ' '}</div><div className="der">{memoriaParams.encabezadoDer}</div></div>
    );
    const pie = (n, tot) => (<div className="mem-pie">Diseño de flexión de vigas · ACI 318-19 / E.060 — Página {n} de {tot}</div>);
    const filaIn = (t, desc) => (
      <div className="mem-fila"><div className="mem-eq"><span className="mem-inbox" dangerouslySetInnerHTML={{ __html: tex(t) }} /></div><div className="mem-desc">{desc}</div></div>
    );
    const filaC = (t, desc) => (
      <div className="mem-fila mem-eqc"><div style={{ flex: '1' }}><span dangerouslySetInnerHTML={{ __html: tex(t) }} /></div>{desc ? <div style={{ flex: '0 0 auto', maxWidth: '52mm', fontStyle: 'italic', color: '#555', textAlign: 'right' }}>{desc}</div> : null}</div>
    );
    const titulo = (
      <div className="text-center" style={{ marginBottom: '5mm' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', letterSpacing: '0.01em' }}>DISEÑO DE FLEXIÓN DE VIGAS SEGÚN ACI 318-19</div>
        <div style={{ fontSize: '10pt', marginTop: '1.5mm' }}><b>Proyecto:</b> {proyecto || '—'}</div>
        <div style={{ borderBottom: '0.6pt solid #1a1a1a', marginTop: '2.5mm' }}></div>
      </div>
    );
    const eAseTex = `A_{se} := \\begin{cases} \\max(A_s,\\,A_{stem},\\,A_{smin}) & A_s < A_{smax} \\\\[6pt] \\text{Cambiar dimension} & A_s > A_{smax} \\end{cases} = ${d.excede ? '\\text{Cambiar dimension}' : f2(d.Ase) + U2}`;
    return (
      <>
        {/* PÁGINA 1 (A4) — datos + A. cálculo de refuerzo */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          {titulo}
          <div className="mem-head">Datos de la viga</div>
          {filaIn(`h_v := ${fm(d.hv)}${U}`, 'Altura de viga')}
          {filaIn(`b := ${fm(d.b)}${U}`, 'Ancho de viga')}
          {filaIn(`r := ${fm(d.r)}${U}`, 'Recubrimiento de la viga')}
          {filaIn(`d := h_v - r = ${fm(d.d)}${U}`, 'Canto útil de la viga')}
          {filaIn(`\\phi := ${f2(d.phi0)}`, 'Factor de reducción de resistencia por flexión')}
          {filaIn(`f'_c := ${fm(d.fc)}${UK}`, 'Resistencia a compresión del concreto')}
          {filaIn(`f_y := ${fm(d.fy)}${UK}`, 'Esfuerzo de fluencia del acero')}
          {filaIn(`E_s := ${fm(d.Es)}${UK}`, 'Módulo de elasticidad del acero')}
          {filaIn(`M_u := ${f2(d.Mu)}${UKC}`, 'Momento flector amplificado (del análisis)')}
          <div className="mem-head">A. Cálculo de refuerzo</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '1mm 0' }}><div style={{ width: '140mm' }}><SvgFlexionBloque width={440} /></div></div>
          {filaC(`a := d - \\sqrt{d^{2} - \\dfrac{2\\,M_u}{0.85\\,f'_c\\,\\phi\\,b}} = ${f2(d.a)}${U}`, 'Profundidad del bloque equivalente')}
          {filaC(`A_s := \\dfrac{0.85\\,f'_c\\,a\\,b}{f_y} = ${f2(d.As)}${U2} \\qquad \\rho := \\dfrac{A_s}{d\\,b} = ${f4(d.rho)}`, '')}
          {pie(1, 5)}
        </div>
        {/* PÁGINA 2 (A4) — B. verificación del acero máximo */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">B. Verificación del acero máximo</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '1mm 0 2mm' }}><div style={{ width: '95mm' }}><SvgDeformaciones width={320} /></div></div>
          {filaC(`\\beta_1 := \\min\\!\\Big(\\max\\big(0.85 - (f'_c-280)\\tfrac{0.05}{70},\\,0.65\\big),\\,0.85\\Big) = ${f2(d.beta1)}`, 'ACI 318-19 art. 22.2.2.4.3')}
          {filaC(`c := \\dfrac{a}{\\beta_1} = ${f2(d.c)}${U} \\qquad \\varepsilon_t := \\dfrac{d-c}{c}\\,(0.003) = ${f4(d.et)}`, 'ACI 318-19 art. 21.2.2')}
          {filaC(`\\varepsilon_{yt} := \\dfrac{f_y}{E_s} = ${f4(d.eyt)} \\qquad \\varepsilon_{s,min} := \\varepsilon_{yt} + 0.003 = ${f4(d.esmin)}`, 'ACI 318-19 art. 21.2.2.1')}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '2mm 0' }}><div style={{ width: '110mm' }}><SvgPhiEt width={360} /></div></div>
          <div style={{ fontSize: '8pt', color: '#555', textAlign: 'center', marginBottom: '2mm' }}>Fig. R21.2.2b — Variación de φ con la deformación unitaria neta a tracción εt.</div>
          {filaC(`\\phi := \\min\\!\\Big(\\max\\big(0.65 + 0.25\\tfrac{\\varepsilon_t-\\varepsilon_{yt}}{\\varepsilon_{c,max}},\\,0.65\\big),\\,0.9\\Big) = ${f2(d.phiCalc)}`, 'ACI 318-19 Art. R21.2.2')}
          {pie(2, 5)}
        </div>
        {/* PÁGINA 3 (A4) — acero máximo E.060 y ACI */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">Acero máximo a colocar — E.060 Art. 10.3.4</div>
          {filaC(`\\rho_b := \\beta_1\\,0.85\\,\\dfrac{f'_c}{f_y}\\left(\\dfrac{6000}{6000+f_y}\\right) = ${f4(d.rhob)}`, 'Cuantía balanceada')}
          {filaC(`A_{smax} := 0.75\\,\\rho_b\\,b\\,d = ${f2(d.Asmax1034)}${U2}`, '')}
          <div className="mem-head">Acero máximo a colocar — E.060 Art. 10.3.5</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '1mm 0' }}><div style={{ width: '90mm' }}><SvgDeformaciones width={320} etLabel="0.004" /></div></div>
          {filaC(`c_{max} := \\tfrac{3}{7}\\,d = ${fm(d.cmax)}${U} \\qquad a_{max} := \\beta_1\\,c_{max} = ${f2(d.amax)}${U}`, 'De εt = 0.004')}
          {filaC(`A_{smax} := \\dfrac{0.85\\,f'_c\\,a_{max}\\,b}{f_y} = ${f2(d.Asmax1035)}${U2} \\qquad \\rho_{max} := \\dfrac{A_{smax}}{d\\,b} = ${f4(d.rhomax1035)}`, '')}
          {filaC(`\\dfrac{\\rho_{max}}{\\rho_b} = ${f4(d.ratio1035)}`, '')}
          <div className="mem-head">Acero máximo a colocar — ACI 318-19 Art. 18.6.3.1</div>
          {filaC(`A_{smax} := 0.025\\,b\\,d = ${f2(d.AsmaxACI)}${U2} \\qquad \\rho_{max} := \\dfrac{A_{smax}}{d\\,b} = ${f4(d.rhomaxACI)} \\qquad \\dfrac{\\rho_{max}}{\\rho_b} = ${f4(d.ratioACI)}`, '')}
          {pie(3, 5)}
        </div>
        {/* PÁGINA 4 (A4) — resumen %ρb + acero mínimo + temperatura */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">Cuantía colocada respecto a la balanceada</div>
          <table className="esp-tbl" style={{ maxWidth: '120mm', margin: '1mm auto 2mm' }}><thead>
            <tr><th>E.060 Art. 10.3.4</th><th>E.060 Art. 10.3.5</th><th>ACI 318-19 18.6.3.1</th></tr>
          </thead><tbody>
            <tr><td>{pp(0.75)}% · ρ<sub>b</sub></td><td>{pp(d.ratio1035)}% · ρ<sub>b</sub></td><td>{pp(d.ratioACI)}% · ρ<sub>b</sub></td></tr>
          </tbody></table>
          {filaC(`\\dfrac{\\rho}{\\rho_b} = ${f2(d.rhoRhob)}`, 'Porcentaje de la cuantía balanceada del acero colocado')}
          <div className="mem-head">C. Verificación del acero mínimo por flexión</div>
          {filaC(`A_{smin1} := \\dfrac{0.8\\sqrt{f'_c}}{f_y}\\,b\\,d = ${f2(d.Asmin1)}${U2} \\qquad A_{smin2} := \\dfrac{14}{f_y}\\,b\\,d = ${f2(d.Asmin2)}${U2}`, 'ACI 318-19 art. 9.6.1.2')}
          {filaC(`\\tfrac{4}{3}A_s = ${f2(d.Asmin3)}${U2} \\qquad A_{smin} := \\min\\!\\Big(\\max(A_{smin1},A_{smin2}),\\,\\tfrac{4}{3}A_s\\Big) = ${f2(d.Asmin)}${U2}`, 'ACI 318-19 art. 9.6.1.3')}
          <div className="mem-head">D. Verificación del acero de temperatura</div>
          {filaC(`A_{stem} := 0.0018\\,b\\,h_v = ${f2(d.Astem)}${U2}`, 'ACI 318-19 art. 24.4.3.2')}
          {pie(4, 5)}
        </div>
        {/* PÁGINA 5 (A4) — acero necesario + acero a colocar */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">E. Acero necesario</div>
          {filaC(eAseTex, '')}
          <div className="mem-head">F. Acero a colocar</div>
          {filaC(`A_{v1} := ${f2(d.Av1)}${U2}`, `Área de varilla tipo ø ${d.barra}`)}
          {filaC(`N_v := \\dfrac{A_{se}}{A_{v1}} = ${f2(d.Nv)}`, 'Número de varillas (se redondea hacia arriba)')}
          {!d.excede && (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '3mm 0 1mm' }}><div style={{ width: '62mm' }}><SvgSeccionVigaBarras b={fm(d.b)} hv={fm(d.hv)} n={d.Ncol} barra={d.barra} width={200} /></div></div>
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '11pt', color: AZ }}>Empleamos {d.Ncol} ø {d.barra}</div>
            </>
          )}
          {d.excede && <div style={{ textAlign: 'center', fontWeight: 'bold', color: '#b91c1c', padding: '10mm 0' }}>As &gt; As,máx → Cambiar las dimensiones de la sección.</div>}
          {pie(5, 5)}
        </div>
      </>
    );
  };

  // Hoja(s) A4 de la memoria de DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN, 2 páginas.
  const renderHojaDistribucion = () => {
    const D = calcDistribucion(distribParams);
    const f2 = x => (Math.round(x * 100 + 1e-6) / 100).toFixed(2);
    const AZ = '#1d4ed8';
    const UKC = `\\;\\textcolor{${AZ}}{\\mathbf{kgf\\!\\cdot\\!cm}}`;
    const header = () => (
      <div className="mem-header"><div className="izq">{memoriaParams.encabezadoIzq || ' '}</div><div className="der">{memoriaParams.encabezadoDer}</div></div>
    );
    const pie = (n, tot) => (<div className="mem-pie">Distribución de refuerzo por flexión · ACI 318-19 18.4.2.2 / E.060 21.4.4.2 — Página {n} de {tot}</div>);
    const filaIn = (t, desc) => (
      <div className="mem-fila"><div className="mem-eq"><span className="mem-inbox" dangerouslySetInnerHTML={{ __html: tex(t) }} /></div><div className="mem-desc">{desc}</div></div>
    );
    const filaC = (t, desc) => (
      <div className="mem-fila mem-eqc"><div style={{ flex: '1' }}><span dangerouslySetInnerHTML={{ __html: tex(t) }} /></div>{desc ? <div style={{ flex: '0 0 auto', maxWidth: '60mm', fontStyle: 'italic', color: '#555', textAlign: 'right' }}>{desc}</div> : null}</div>
    );
    const titulo = (
      <div className="text-center" style={{ marginBottom: '5mm' }}>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', letterSpacing: '0.01em' }}>DISTRIBUCIÓN DE REFUERZO POR FLEXIÓN SEGÚN ACI 318-19</div>
        <div style={{ fontSize: '9.5pt', fontWeight: 'bold', marginTop: '1mm' }}>(Art. 18.4.2.2) · E.060 Art. 21.4.4.2</div>
        <div style={{ fontSize: '10pt', marginTop: '1.5mm' }}><b>Proyecto:</b> {proyecto || '—'}</div>
        <div style={{ borderBottom: '0.6pt solid #1a1a1a', marginTop: '2.5mm' }}></div>
      </div>
    );
    return (
      <>
        {/* PÁGINA 1 (A4) — momentos de diseño + envolvente */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          {titulo}
          <div className="mem-head">1. Momentos de diseño</div>
          {filaIn(`M_1 := ${f2(D.M1)}${UKC}`, 'Momento negativo, cara izquierda')}
          {filaIn(`M_2 := ${f2(D.M2)}${UKC}`, 'Momento negativo, cara derecha')}
          {filaIn(`M_3 := ${f2(D.M3)}${UKC}`, 'Momento positivo, centro de luz')}
          {filaC(`M_4 := \\dfrac{M_1}{3} = ${f2(D.M4)}${UKC}`, 'Mínimo positivo en cara izquierda')}
          {filaC(`M_5 := \\dfrac{M_2}{3} = ${f2(D.M5)}${UKC}`, 'Mínimo positivo en cara derecha')}
          {filaC(`M_6 := \\dfrac{\\max(M_1,M_2)}{5} = ${f2(D.M6)}${UKC}`, 'Mínimo en cualquier sección')}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '4mm 0 1mm' }}><div style={{ width: '160mm' }}><SvgDistribRefuerzo datos={D} modo="M" width={480} /></div></div>
          <div style={{ fontSize: '8.5pt', color: '#555', textAlign: 'center' }}>Envolvente de momentos flectores (kgf·cm) a lo largo de la viga.</div>
          {pie(1, 2)}
        </div>
        {/* PÁGINA 2 (A4) — acero requerido + distribución */}
        <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
          {header()}
          <div className="mem-head">2. Acero requerido en cada sección</div>
          <table className="esp-tbl" style={{ fontSize: '7.5pt' }}><thead>
            <tr><th>M</th><th>b</th><th>d</th><th>f'c</th><th>fy</th><th>ø</th><th>Mu (kgf·cm)</th><th>a (cm)</th><th>As,mín</th><th>As,req</th><th>As (cm²)</th></tr>
          </thead><tbody>
            {D.filas.map(f => (
              <tr key={f.tag}><td>{f.tag}</td><td>{D.b}</td><td>{D.d}</td><td>{D.fc}</td><td>{D.fy}</td><td>{D.phi}</td><td style={{ textAlign: 'right' }}>{f2(f.M)}</td><td>{f2(f.a)}</td><td>{f2(f.Asmin)}</td><td>{f2(f.Asres)}</td><td style={{ fontWeight: 'bold' }}>{f2(f.As)}</td></tr>
            ))}
          </tbody></table>
          <div style={{ fontSize: '8pt', color: '#555', margin: '1mm 0 3mm' }}>As = máx(As,req ; As,mín), con As,mín = mín( máx(0.8√f'c/fy·b·d ; 14/fy·b·d) ; 4/3·As,req ).</div>
          <div className="mem-head">3. Distribución del refuerzo a lo largo de la viga</div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '3mm 0 1mm' }}><div style={{ width: '160mm' }}><SvgDistribRefuerzo datos={D} modo="As" width={480} /></div></div>
          <div className="esp-resumen" style={{ justifyContent: 'center', gap: '8mm', fontSize: '9pt', marginTop: '2mm' }}>
            <div>A<sub>s1</sub> = <b>{f2(D.filas[0].As)}</b> · A<sub>s2</sub> = <b>{f2(D.filas[1].As)}</b> · A<sub>s3</sub> = <b>{f2(D.filas[2].As)}</b> cm²</div>
            <div>A<sub>s4</sub> = <b>{f2(D.filas[3].As)}</b> · A<sub>s5</sub> = <b>{f2(D.filas[4].As)}</b> · A<sub>s6</sub> = <b>{f2(D.filas[5].As)}</b> cm²</div>
          </div>
          {pie(2, 2)}
        </div>
      </>
    );
  };

  const renderMemoria = () => {
    const inp = "w-full bg-black/40 border border-white/10 p-2 rounded-lg text-xs text-slate-200 font-mono outline-none focus:border-cyan-500";
    const lbl = "text-[9px] text-slate-500 font-black uppercase block mb-1";
    const esEsp = memoriaTipo === 'espectro';
    const esDes = memoriaTipo === 'desarrollo';
    const esFlx = memoriaTipo === 'flexion';
    const esDist = memoriaTipo === 'distrib';
    const esMat = memoriaTipo === 'materiales';
    const nombreDoc = esEsp ? 'espectro de respuesta' : esDes ? 'longitud de desarrollo a tracción' : esFlx ? 'diseño de flexión de vigas' : esDist ? 'distribución de refuerzo por flexión' : 'materiales';
    const tabBtn = (k, txt) => (
      <button onClick={() => setMemoriaTipo(k)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors ${memoriaTipo === k ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-300' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'}`}>{txt}</button>
    );
    return (
      <div className="flex-grow overflow-auto p-6 bg-[#0a0c12]">
        <div className="mx-auto" style={{ width: 'min(100%, 210mm)' }}>
          <div className="no-print flex items-center justify-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-black text-cyan-300 uppercase tracking-widest">📄 Memoria de calculo · {nombreDoc}</h2>
              <p className="text-[9px] text-slate-500 mt-1">Determinista (sin IA): formato hoja A4. Exporta a PDF (impresion del navegador) o como codigo LaTeX.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExportarPdf} className="bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 px-5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20 transition-all">🖨️ Exportar a PDF</button>
              <button onClick={handleCopiarLatex} className="bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-cyan-300 transition-colors">Copiar LaTeX</button>
              <button onClick={handleDescargarTex} className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-300 transition-colors">.tex</button>
            </div>
          </div>

          <div className="no-print flex items-center gap-2 mb-3">
            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">Documento:</span>
            {tabBtn('materiales', '🧱 Materiales')}
            {tabBtn('espectro', '📈 Espectro de respuesta')}
            {tabBtn('desarrollo', '🔩 Longitud de desarrollo')}
            {tabBtn('flexion', '📐 Flexión de vigas')}
            {tabBtn('distrib', '📊 Distribución de refuerzo')}
          </div>

          {esEsp && (
            <div className="no-print grid grid-cols-4 gap-3 mb-5 items-end bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <div className="col-span-2"><label className={lbl}>Encabezado izquierda (proyecto / empresa)</label><input value={memoriaParams.encabezadoIzq} onChange={e => setMem('encabezadoIzq', e.target.value)} placeholder="Ej: Edificio de 15 pisos" className={inp} /></div>
              <div className="col-span-2"><label className={lbl}>Encabezado derecha (web / autor / fecha)</label><input value={memoriaParams.encabezadoDer} onChange={e => setMem('encabezadoDer', e.target.value)} placeholder="Ej: Ing. Juan Perez" className={inp} /></div>
              <p className="col-span-4 text-[9px] text-amber-300/80 -mt-1">Los parametros sismicos (zona, suelo, uso, sistema, irregularidades) se editan en la pestana El Espectro de Diseño; este documento los refleja en vivo.</p>
            </div>
          )}

          {esDes && (
            <div className="no-print grid grid-cols-4 gap-3 mb-5 items-end bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <div><label className={lbl}>f'c (kgf/cm2)</label><input type="number" step="10" value={desarrolloParams.fc} onChange={e => setDes('fc', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>fy (kgf/cm2)</label><input type="number" step="100" value={desarrolloParams.fy} onChange={e => setDes('fy', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Barra longitudinal (db)</label><select value={desarrolloParams.barra} onChange={e => setDes('barra', e.target.value)} className={inp}>{BARRAS_ACERO.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
              <div><label className={lbl}>Estribo (dt)</label><select value={desarrolloParams.estribo} onChange={e => setDes('estribo', e.target.value)} className={inp}>{BARRAS_ACERO.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
              <div><label className={lbl}>λ (peso concreto)</label><input type="number" step="0.05" value={desarrolloParams.lambda} onChange={e => setDes('lambda', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ψt (posición)</label><input type="number" step="0.1" value={desarrolloParams.psiT} onChange={e => setDes('psiT', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ψe (recubrim.)</label><input type="number" step="0.1" value={desarrolloParams.psiE} onChange={e => setDes('psiE', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ψg (grado)</label><input type="number" step="0.1" value={desarrolloParams.psiG} onChange={e => setDes('psiG', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ψs (tamaño)</label><input type="number" step="0.1" value={desarrolloParams.psiS} onChange={e => setDes('psiS', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>r recubrim. (cm)</label><input type="number" step="0.5" value={desarrolloParams.r} onChange={e => setDes('r', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>s estribos (cm)</label><input type="number" step="1" value={desarrolloParams.s} onChange={e => setDes('s', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>n barras / capa</label><input type="number" step="1" value={desarrolloParams.n} onChange={e => setDes('n', e.target.value)} className={inp} /></div>
              <div className="col-span-2"><label className={lbl}>Encabezado izquierda (proyecto / empresa)</label><input value={memoriaParams.encabezadoIzq} onChange={e => setMem('encabezadoIzq', e.target.value)} className={inp} /></div>
              <div className="col-span-2"><label className={lbl}>Encabezado derecha (web / autor / fecha)</label><input value={memoriaParams.encabezadoDer} onChange={e => setMem('encabezadoDer', e.target.value)} className={inp} /></div>
              <p className="col-span-4 text-[9px] text-amber-300/80 -mt-1">Reproduce la hoja Mathcad de longitud de desarrollo a tracción (E.060 / ACI 318-19); los valores se recalculan en vivo.</p>
            </div>
          )}

          {esFlx && (
            <div className="no-print grid grid-cols-4 gap-3 mb-5 items-end bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <div><label className={lbl}>hv altura (cm)</label><input type="number" step="5" value={flexionParams.hv} onChange={e => setFlx('hv', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>b ancho (cm)</label><input type="number" step="5" value={flexionParams.b} onChange={e => setFlx('b', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>r recubrim. (cm)</label><input type="number" step="0.5" value={flexionParams.r} onChange={e => setFlx('r', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ø factor flexión</label><input type="number" step="0.05" value={flexionParams.phi} onChange={e => setFlx('phi', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>f'c (kgf/cm2)</label><input type="number" step="10" value={flexionParams.fc} onChange={e => setFlx('fc', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>fy (kgf/cm2)</label><input type="number" step="100" value={flexionParams.fy} onChange={e => setFlx('fy', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Es (kgf/cm2)</label><input type="number" step="100000" value={flexionParams.es} onChange={e => setFlx('es', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Mu (kgf·cm)</label><input type="number" step="1000" value={flexionParams.Mu} onChange={e => setFlx('Mu', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Varilla a colocar</label><select value={flexionParams.barra} onChange={e => setFlx('barra', e.target.value)} className={inp}>{BARRAS_ACERO.map(b => <option key={b.id} value={b.id}>{b.label} (A={b.area} cm²)</option>)}</select></div>
              <div className="col-span-2"><label className={lbl}>Encabezado izquierda (proyecto / empresa)</label><input value={memoriaParams.encabezadoIzq} onChange={e => setMem('encabezadoIzq', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Encabezado derecha</label><input value={memoriaParams.encabezadoDer} onChange={e => setMem('encabezadoDer', e.target.value)} className={inp} /></div>
              <p className="col-span-4 text-[9px] text-amber-300/80 -mt-1">Diseño de flexión de vigas (ACI 318-19 / E.060). Mu en kgf·cm; los valores se recalculan en vivo.</p>
            </div>
          )}

          {esDist && (
            <div className="no-print grid grid-cols-4 gap-3 mb-5 items-end bg-white/[0.02] border border-white/5 rounded-2xl p-4">
              <div><label className={lbl}>b ancho (cm)</label><input type="number" step="5" value={distribParams.b} onChange={e => setDist('b', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>d peralte efectivo (cm)</label><input type="number" step="1" value={distribParams.d} onChange={e => setDist('d', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>f'c (kgf/cm2)</label><input type="number" step="10" value={distribParams.fc} onChange={e => setDist('fc', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>fy (kgf/cm2)</label><input type="number" step="100" value={distribParams.fy} onChange={e => setDist('fy', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>ø factor flexión</label><input type="number" step="0.05" value={distribParams.phi} onChange={e => setDist('phi', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>M₁ cara izq. (−) kgf·cm</label><input type="number" step="10000" value={distribParams.M1} onChange={e => setDist('M1', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>M₂ cara der. (−) kgf·cm</label><input type="number" step="10000" value={distribParams.M2} onChange={e => setDist('M2', e.target.value)} className={inp} /></div>
              <div><label className={lbl}>M₃ centro (+) kgf·cm</label><input type="number" step="10000" value={distribParams.M3} onChange={e => setDist('M3', e.target.value)} className={inp} /></div>
              <div className="col-span-2"><label className={lbl}>Encabezado izquierda (proyecto / empresa)</label><input value={memoriaParams.encabezadoIzq} onChange={e => setMem('encabezadoIzq', e.target.value)} className={inp} /></div>
              <div className="col-span-2"><label className={lbl}>Encabezado derecha</label><input value={memoriaParams.encabezadoDer} onChange={e => setMem('encabezadoDer', e.target.value)} className={inp} /></div>
              <p className="col-span-4 text-[9px] text-amber-300/80 -mt-1">M₄=M₁/3, M₅=M₂/3 y M₆=máx(M₁,M₂)/5 se calculan solos (ACI 18.4.2.2 / E.060 21.4.4.2). Momentos en kgf·cm.</p>
            </div>
          )}

          {esMat && (
          <div className="no-print grid grid-cols-4 gap-3 mb-5 items-end bg-white/[0.02] border border-white/5 rounded-2xl p-4">
            <div>
              <label className={lbl}>Norma</label>
              <select value={memoriaParams.norma} onChange={e => setMem('norma', e.target.value)} className={inp}>
                <option value="E060">E.060 (Peru)</option>
                <option value="ACI">ACI 318-19</option>
              </select>
            </div>
            <div><label className={lbl}>f'c (kgf/cm2)</label><input type="number" step="10" value={memoriaParams.fc} onChange={e => setMem('fc', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>fy (kgf/cm2)</label><input type="number" step="100" value={memoriaParams.fy} onChange={e => setMem('fy', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>Es (kgf/cm2)</label><input type="number" step="100000" value={memoriaParams.es} onChange={e => setMem('es', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>γ concreto (kgf/m3)</label><input type="number" step="50" value={memoriaParams.gammaC} onChange={e => setMem('gammaC', e.target.value)} className={inp} /></div>
            <div><label className={lbl}>γ acero (kgf/m3)</label><input type="number" step="50" value={memoriaParams.gammaS} onChange={e => setMem('gammaS', e.target.value)} className={inp} /></div>
            {memoriaParams.norma === 'ACI' && <div><label className={lbl}>Poisson νc</label><input type="number" step="0.01" value={memoriaParams.poisson} onChange={e => setMem('poisson', e.target.value)} className={inp} /></div>}
            <div className="col-span-2"><label className={lbl}>Encabezado izquierda (proyecto / empresa)</label><input value={memoriaParams.encabezadoIzq} onChange={e => setMem('encabezadoIzq', e.target.value)} placeholder="Ej: Edificio Multifamiliar - Calle X" className={inp} /></div>
            <div className="col-span-2"><label className={lbl}>Encabezado derecha (web / autor / fecha)</label><input value={memoriaParams.encabezadoDer} onChange={e => setMem('encabezadoDer', e.target.value)} placeholder="Ej: Ing. Juan Perez" className={inp} /></div>
          </div>
          )}

          {/* Hoja(s) A4 — se exporta a PDF tal cual con la impresion del navegador.
              #memoria-hoja envuelve 1+ paginas .hoja-a4 (materiales=1, espectro=3, desarrollo=3, flexion=5, distrib=2). */}
          <div id="memoria-hoja" className="memoria-pages mx-auto">
          {esEsp ? renderHojaEspectro() : esDes ? renderHojaDesarrollo() : esFlx ? renderHojaFlexion() : esDist ? renderHojaDistribucion() : (
          <div className="hoja-a4 rounded-sm shadow-2xl shadow-black/60">
            <div className="mem-header">
              <div className="izq">{memoriaParams.encabezadoIzq || ' '}</div>
              <div className="der">{memoriaParams.encabezadoDer}</div>
            </div>
            <div className="text-center" style={{ marginBottom: '7mm' }}>
              <div style={{ fontSize: '13pt', fontWeight: 'bold', letterSpacing: '0.02em' }}>ANEXO &mdash; {memoria.titulo}</div>
              <div style={{ fontSize: '10.5pt', fontWeight: 'bold', marginTop: '1.5mm' }}>1. Caracteristicas de elementos de concreto armado</div>
              <div style={{ borderBottom: '0.6pt solid #1a1a1a', marginTop: '3mm' }}></div>
            </div>
            {memoria.lineas.map((ln, i) => (
              ln.kind === 'head' ? (
                <div key={i} className="mem-head">{ln.desc}</div>
              ) : ln.kind === 'input' ? (
                <div key={i} className="mem-fila">
                  <div className="mem-eq"><span dangerouslySetInnerHTML={{ __html: tex(ln.tex) }} /></div>
                  <div className="mem-desc">{ln.desc}</div>
                </div>
              ) : (
                <div key={i} className="mem-fila mem-eqc">
                  <div style={{ flex: '1' }}><span dangerouslySetInnerHTML={{ __html: tex(ln.tex) }} /></div>
                  <div style={{ flex: '0 0 auto', fontStyle: 'italic', color: '#555' }}>{ln.desc}</div>
                </div>
              )
            ))}
            <div className="mem-pie">Pagina 1 de 1</div>
          </div>
          )}
          </div>
          <p className="no-print text-[8.5px] text-slate-500 mt-2">El .tex numera las paginas automaticamente (fancyhdr + lastpage){esEsp ? '; la tabla T-Sa usa longtable y el grafico pgfplots (Overleaf)' : ''}. En el PDF del navegador, el pie muestra el numero al fondo de la hoja.</p>

          <details className="no-print mt-5 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
            <summary className="text-[10px] font-black text-cyan-300 uppercase tracking-widest cursor-pointer">Ver codigo LaTeX</summary>
            <pre className="text-[9.5px] text-slate-400 font-mono whitespace-pre-wrap mt-3 max-h-80 overflow-y-auto">{memoDoc.latex}</pre>
          </details>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen text-slate-300 font-sans overflow-hidden" style={{ background: 'radial-gradient(1100px 520px at 12% -8%, rgba(37,99,235,0.08), transparent 60%), radial-gradient(900px 480px at 100% 0%, rgba(245,158,11,0.05), transparent 55%), radial-gradient(800px 700px at 50% 118%, rgba(37,99,235,0.045), transparent 60%), #060709' }}>
      <style>{`
        ::-webkit-scrollbar { width: 9px; height: 9px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,.18); border-radius: 6px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(59,130,246,.35); }
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-8px) translateX(-50%); } to { opacity: 1; transform: translateY(0) translateX(-50%); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spinRing { to { transform: rotate(360deg); } }
        .anim-toast { animation: fadeSlideIn .25s ease-out; }
        .anim-panel { animation: fadeIn .2s ease-out; }
        .spin-ring { animation: spinRing 1s linear infinite; }
        select option { background: #0d1017; color: #cbd5e1; }
        /* Contenedor multipagina: apila las hojas A4 en pantalla como un documento */
        .memoria-pages { display: flex; flex-direction: column; align-items: center; gap: 8mm; }
        /* Hoja A4 de la memoria de calculo — tipografia estilo LaTeX (Computer Modern) */
        .hoja-a4 {
          width: 210mm; min-height: 297mm; box-sizing: border-box;
          padding: 22mm 22mm 16mm 22mm; background: #fff; color: #1a1a1a;
          font-family: 'KaTeX_Main', 'Latin Modern Roman', 'CMU Serif', 'Georgia', 'Times New Roman', serif;
          font-size: 10pt; line-height: 1.5; text-rendering: optimizeLegibility;
          display: flex; flex-direction: column;   /* el pie se empuja al fondo */
        }
        .hoja-a4 * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* Formulas a la MISMA escala que el texto del cuerpo (KaTeX rinde a 1.21em por defecto) */
        .hoja-a4 .katex { font-size: 1em; }
        .hoja-a4 .mem-fila { display: flex; align-items: center; gap: 8mm; min-height: 9mm; }
        .hoja-a4 .mem-eq { flex: 0 0 62mm; }
        .hoja-a4 .mem-desc { flex: 1; }
        .hoja-a4 .mem-head { font-weight: bold; margin: 5mm 0 1.5mm; }
        .hoja-a4 .mem-eqc { margin: 1.5mm 0 1.5mm 6mm; }   /* ecuacion de calculo, ligeramente indentada */
        /* Caja azul claro en las celdas de DATO (estilo Mathcad), usada en Long. de desarrollo */
        .hoja-a4 .mem-inbox { background: #e8f1fd; border: 0.4pt solid #c7ddf7; border-radius: 2px; padding: 0.4mm 2mm; }
        /* Encabezado del documento (proyecto) y pie */
        .hoja-a4 .mem-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 0.8pt solid #1a1a1a; padding-bottom: 2mm; margin-bottom: 6mm; }
        .hoja-a4 .mem-header .izq { font-weight: bold; font-size: 11pt; }
        .hoja-a4 .mem-header .der { font-size: 9pt; color: #444; }
        /* Pie de pagina: SOLO el numero de pagina, empujado al fondo de la hoja */
        .hoja-a4 .mem-pie { margin-top: auto; border-top: 0.5pt solid #999; padding-top: 2mm; text-align: center; font-size: 8.5pt; color: #555; }
        .hoja-a4 .mem-cuerpo { flex: 0 0 auto; }
        /* Documento del ESPECTRO DE RESPUESTA (ANEXO 2): tablas con bordes, secciones */
        .hoja-a4 .esp-sec { font-weight: bold; font-size: 11pt; margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 0.6pt solid #1a1a1a; }
        .hoja-a4 .esp-cap { font-size: 8.5pt; font-weight: bold; color: #b91c1c; margin: 2mm 0 1mm; }
        .hoja-a4 .esp-grid2 { display: flex; gap: 6mm; align-items: flex-start; }
        .hoja-a4 .esp-grid2 > div, .hoja-a4 .esp-grid2 > table { flex: 1; }
        .hoja-a4 table.esp-tbl { border-collapse: collapse; width: 100%; margin: 1mm 0 3mm; font-size: 8.5pt; }
        .hoja-a4 table.esp-tbl th, .hoja-a4 table.esp-tbl td { border: 0.5pt solid #555; padding: 0.8mm 2mm; text-align: center; }
        .hoja-a4 table.esp-tbl th { background: #eef0f2; font-weight: bold; }
        .hoja-a4 .esp-resumen { display: flex; gap: 6mm; align-items: flex-start; flex-wrap: wrap; margin: 1mm 0 2mm; }
        .hoja-a4 .esp-formula { flex: 1; min-width: 60mm; display: flex; flex-direction: column; gap: 3mm; justify-content: center; }
        .hoja-a4 .esp-charts { display: flex; gap: 5mm; justify-content: center; margin: 2mm 0 3mm; flex-wrap: wrap; }
        .hoja-a4 table.esp-sa { border-collapse: collapse; width: 100%; font-size: 7.5pt; }
        .hoja-a4 table.esp-sa th, .hoja-a4 table.esp-sa td { border: 0.4pt solid #999; padding: 0.3mm 1.5mm; text-align: center; }
        .hoja-a4 table.esp-sa th { background: #eef0f2; font-weight: bold; }
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          #memoria-hoja, #memoria-hoja * { visibility: visible !important; }
          /* El contenedor se aisla arriba; cada hoja A4 hija pagina a una pagina fisica */
          #memoria-hoja { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; gap: 0 !important; display: block !important; }
          /* min-height fija el area imprimible para que el pie quede abajo de cada pagina */
          #memoria-hoja .hoja-a4 { width: 100%; min-height: 269mm; margin: 0; padding: 0; box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
          #memoria-hoja .hoja-a4:last-child { page-break-after: auto; break-after: auto; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="flex-grow flex flex-col border-r border-white/5 min-w-0">
        <header className="h-16 flex items-center justify-between px-6 bg-[#0a0e16]/55 backdrop-blur-xl border-b border-white/[0.07] gap-4 shrink-0 relative z-20 shadow-[0_1px_0_0_rgba(255,255,255,0.03)]">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/25 to-amber-500/15 border border-cyan-500/30 flex items-center justify-center shadow-lg shadow-cyan-500/15">
              <Zap size={17} className="text-cyan-300" />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-extrabold tracking-[0.2em] bg-gradient-to-r from-cyan-300 via-cyan-200 to-amber-300 bg-clip-text text-transparent">ETABS API + IA</div>
              <div className="text-[8.5px] text-slate-500 font-semibold tracking-[0.22em] uppercase">Ingeniería controlada · {APP_VERSION}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 justify-end min-w-0">
            <select value={sessionMode} onChange={e => setSessionMode(e.target.value)} className="bg-black/40 border border-white/10 hover:border-cyan-500/40 px-3 py-2.5 rounded-xl text-[10px] font-bold text-slate-200 outline-none max-w-[300px] transition-colors cursor-pointer">
              {SESSION_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
            <button onClick={handlePingServer} className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-2 transition-colors">
              <Cpu size={13} className="text-cyan-400" /> Servidor
            </button>
            <button onClick={handleExecute} disabled={isLoading || sessionMode === 'code_only'} className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-2 text-white shadow-lg shadow-emerald-500/20 disabled:shadow-none transition-all">
              <Play size={13} /> Ejecutar en ETABS
            </button>
          </div>
        </header>

        {serverOutdated && (
          <div className="bg-red-950/80 border-b border-red-500/30 text-red-200 text-[10px] font-bold px-6 py-2 flex items-center gap-2 shrink-0">
            <AlertCircle size={13} className="text-red-400 shrink-0" />
            El servidor Python esta DESACTUALIZADO: cierra su ventana y vuelve a ejecutar INICIAR TODO.bat para cargar las funciones nuevas. Algunas funciones fallaran hasta entonces.
          </div>
        )}

        <div className="px-6 pt-3 flex gap-0.5 bg-[#090c13]/70 backdrop-blur-md border-b border-white/[0.06] shrink-0 relative z-10">
          {[
            ['flujo', '🧭', 'Flujo de trabajo'],
            ['codigo', '</>', 'Código + Terminal'],
            ['vista', '📈', 'El Espectro de Diseño'],
            ['modelador', '✏️', 'Modelador'],
            ['resultados', '📊', 'Resultados'],
            ['opensees', '🔧', 'OpenSees'],
            ['memoria', '📄', 'Memoria'],
          ].map(([id, ic, lbl]) => (
            <button key={id} onClick={() => setMainTab(id)}
              className={`relative whitespace-nowrap px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] transition-all duration-200 flex items-center gap-2 rounded-t-lg ${mainTab === id ? 'text-cyan-100' : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.025]'}`}>
              <span className="text-[13px] leading-none">{ic}</span>{lbl}
              {mainTab === id && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2.5px] rounded-full bg-gradient-to-r from-cyan-400 to-amber-400 shadow-[0_0_10px_rgba(37,99,235,0.6)]" />}
            </button>
          ))}

          {/* Proyecto activo + instancia de ETABS seleccionada */}
          <div className="ml-auto flex items-center gap-2 pb-1.5">
            <div className="flex items-center gap-1.5" title="Nombre del proyecto (el progreso se guarda por proyecto)">
              <span className="text-[9px] text-slate-500 font-black uppercase">Proyecto</span>
              <input value={proyecto} onChange={e => cambiarProyecto(e.target.value)} className="bg-black/40 border border-white/10 focus:border-cyan-500/50 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-cyan-200 outline-none w-40" placeholder="Proyecto 1" />
            </div>
            <div className="flex items-center gap-1.5" title="Instancia de ETABS a la que se conecta (varios ETABS abiertos)">
              <span className="text-[9px] text-slate-500 font-black uppercase">ETABS</span>
              <select value={instanciaPid} onChange={e => setInstanciaPid(Number(e.target.value))} className="bg-black/40 border border-white/10 hover:border-cyan-500/40 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-200 outline-none max-w-[220px] cursor-pointer">
                <option value={0}>Auto (la registrada)</option>
                {instancias.map(p => <option key={p.pid} value={p.pid}>{(p.titulo_ventana || 'ETABS').replace('ETABS Ultimate 22.0.0 - ', '').slice(0, 28)} · PID {p.pid}</option>)}
              </select>
              <button onClick={cargarInstancias} title="Refrescar lista de instancias" className="bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-1.5 rounded-lg text-[10px] text-slate-300">⟳</button>
            </div>
          </div>
        </div>

        {mainTab === 'flujo' && renderFlujo()}
        {mainTab === 'vista' && renderVista()}
        {mainTab === 'modelador' && renderModelador()}
        {mainTab === 'resultados' && renderResultados()}
        {mainTab === 'opensees' && renderOpenSees()}
        {mainTab === 'memoria' && renderMemoria()}

        {mainTab === 'codigo' && (<>
        <div className="px-6 py-3 bg-[#090c13] border-b border-white/5 grid grid-cols-4 gap-4 shrink-0 items-end">
          <div>
            <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1.5">Modo activo</label>
            <div className="text-[11px] text-cyan-300 font-bold truncate bg-cyan-500/5 border border-cyan-500/15 rounded-lg px-3 py-2">{activeMode.short}</div>
          </div>
          <div className="col-span-2">
            <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1.5">Ruta .EDB opcional</label>
            <input value={modelFilePath} onChange={e => setModelFilePath(e.target.value)} placeholder="Ej: C:\\Modelos\\Edificio_01.edb" className="w-full bg-black/40 border border-white/10 px-3 py-2 rounded-lg text-[11px] font-mono outline-none focus:border-cyan-500/60 text-slate-200 transition-colors placeholder:text-slate-600" />
          </div>
          <div className="flex items-center gap-4 pb-1.5">
            <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={visibleEtabs} onChange={e => setVisibleEtabs(e.target.checked)} />Visible</label>
            <label className="flex items-center gap-2 text-[10px] text-slate-400 font-bold cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={saveBeforeRun} onChange={e => setSaveBeforeRun(e.target.checked)} />Guardar antes</label>
          </div>
        </div>

        {/* Editor con resaltado de sintaxis: el <pre> coloreado va detras y define el
            alto; el <textarea> transparente (texto invisible, solo cursor) va encima y
            captura la edicion. Ambos comparten fuente/tamano/interlineado/padding y
            ajuste de linea para que el cursor caiga exacto sobre el codigo coloreado. */}
        {/* Wrapper relative: ancla el boton "Copiar" a la esquina visible (no scrollea).
            Dentro, el scroller (overflow-auto) y el contexto de posicionamiento (relative)
            van SEPARADOS: si fueran el mismo div, el textarea absoluto (h-full) solo cubriria
            el alto visible y no se podria editar el codigo desplazado. Asi el <pre> en flujo
            normal define el alto total y el textarea absoluto lo cubre completo. */}
        <div className="flex-grow relative overflow-hidden flex flex-col">
          <div className="flex-grow overflow-auto bg-[#070a12] selection:bg-cyan-500/20">
            <div className="relative min-h-full w-full">
              <pre aria-hidden className="m-0 min-h-full p-8 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap break-words pointer-events-none text-slate-300"
                dangerouslySetInnerHTML={{ __html: highlightedCode }} />
              <textarea
                value={pythonCode}
                onChange={e => { setPythonCode(e.target.value); setLastRunOk(false); setLastCodeFromAi(false); }}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="absolute inset-0 w-full h-full p-8 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap break-words bg-transparent text-transparent caret-cyan-300 outline-none resize-none overflow-hidden"
              />
            </div>
          </div>
          <button onClick={handleCopyCode} title="Copiar todo el codigo al portapapeles"
            className="absolute top-3 right-5 z-10 flex items-center gap-1.5 bg-[#0d1017]/90 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-300 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide backdrop-blur-sm transition-colors shadow-lg shadow-black/30">
            <Copy size={12} /> Copiar
          </button>
        </div>

        <div className={`bg-[#05070c] border-t border-white/10 font-mono text-[11.5px] text-slate-400 shrink-0 flex flex-col ${terminalOpen ? 'h-56 overflow-y-auto' : 'h-auto'}`}>
          <div className="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-white/5 sticky top-0 backdrop-blur-sm">
            <button onClick={() => setTerminalOpen(o => !o)} title={terminalOpen ? 'Contraer terminal (mas espacio para el editor)' : 'Expandir terminal'} className="text-emerald-400/90 font-bold flex items-center gap-2 text-[11px] hover:text-emerald-300 transition-colors min-w-0">
              {terminalOpen ? <ChevronDown size={13} className="shrink-0" /> : <ChevronUp size={13} className="shrink-0" />}
              <span className="flex gap-1.5 shrink-0"><span className="w-2 h-2 rounded-full bg-red-500/60"></span><span className="w-2 h-2 rounded-full bg-amber-500/60"></span><span className="w-2 h-2 rounded-full bg-emerald-500/70"></span></span>
              <span className="ml-1 tracking-wide shrink-0">Terminal</span>
              {lastRunOk && <span className="text-[8px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full px-2 py-0.5 font-black uppercase tracking-wider shrink-0">ultima ejecucion OK</span>}
              {!terminalOpen && executionOutput && <span className="text-slate-500 font-normal normal-case truncate">— {executionOutput.split('\n')[0]}</span>}
            </button>
            <div className="flex gap-1.5 items-center">
              <button onClick={handleManualPreflight} title="Revisa el codigo ANTES de mandarlo a ETABS (errores comunes, plantillas sin rellenar, metodos inventados)" className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">Preflight</button>
              <button onClick={handleDownloadScript} title="Descarga el editor como etabs_script.py para correrlo aparte (python etabs_script.py)" className="bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-300 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">Guardar .py</button>
              <label title="Si la ejecucion falla, intenta repararla sola con la IA, una vez" className="flex items-center gap-1.5 text-[9px] text-slate-400 font-bold px-1.5 cursor-pointer select-none"><input type="checkbox" className="accent-cyan-500" checked={autoRepair} onChange={e => setAutoRepair(e.target.checked)} />Auto-reparar</label>
              <button onClick={handleSaveCurrentAsFlow} title="Guarda el codigo actual en la Biblioteca como flujo reutilizable (se habilita en verde tras una ejecucion OK)" className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide border transition-colors ${lastRunOk ? 'bg-emerald-600/90 hover:bg-emerald-500 border-emerald-400/40 text-white shadow-md shadow-emerald-500/20' : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-400'}`}>Guardar como flujo</button>
              <button onClick={handleRepair} disabled={!executionOutput.trim() || isLoading} title="Manda el error de la terminal a la IA para que corrija el codigo (necesita una salida con error)" className="bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 disabled:bg-white/5 disabled:border-white/10 disabled:text-slate-600 text-red-300 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">Reparar con IA</button>
              <button onClick={handleCopyReport} title="Copia al portapapeles un informe (codigo + salida + contexto) para pegarlo en un chat de IA o reporte" className="bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors">Copiar informe</button>
            </div>
          </div>
          {terminalOpen && <pre className="whitespace-pre-wrap px-4 py-3 leading-relaxed">{executionOutput || 'Listo. Ejecuta un script o pidele algo a la IA para ver la salida aqui.'}</pre>}
        </div>
        </>)}
      </div>

      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)} title="Mostrar panel IA / Biblioteca"
          className="shrink-0 w-8 bg-gradient-to-b from-[#0d1017] to-[#0a0d14] border-l border-white/5 hover:bg-cyan-500/5 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-cyan-300 transition-colors">
          <ChevronLeft size={16} />
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ writingMode: 'vertical-rl' }}>Ingenieria IA · Biblioteca</span>
        </button>
      )}
      <aside className={`bg-gradient-to-b from-[#0d1017] to-[#0a0d14] flex flex-col shadow-2xl shrink-0 border-l border-white/5 overflow-hidden transition-[width,opacity] duration-300 ${sidebarOpen ? 'w-[460px] opacity-100' : 'w-0 opacity-0 border-l-0 pointer-events-none'}`}>
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center shrink-0">
              <MessageSquare size={15} className="text-cyan-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 block">Ingenieria IA · {activeLabel}</span>
              <span className="text-[9px] text-cyan-400/90 font-bold truncate block max-w-[240px]">{activeModel || 'Modelo no configurado'} · {activeMode.short}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsDocsOpen(!isDocsOpen)} className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wide transition-colors ${isDocsOpen ? 'bg-cyan-500/15 text-cyan-300' : 'text-slate-500 hover:text-cyan-300 hover:bg-white/5'}`}>API Docs</button>
            <button onClick={() => setIsSettingsOpen(!isSettingsOpen)} className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-300 hover:bg-white/5 transition-colors"><Settings size={16} /></button>
            <button onClick={() => setSidebarOpen(false)} title="Ocultar panel (más área de trabajo)" className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-300 hover:bg-white/5 transition-colors"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="px-5 pt-3 pb-0 flex gap-1.5 border-b border-white/5 bg-black/20">
          <button onClick={() => setActivePanel('tools')} className={`flex-1 px-3 py-2.5 rounded-t-xl text-[10px] font-black uppercase tracking-widest transition-colors border-b-2 ${activePanel === 'tools' ? 'text-cyan-300 border-cyan-400 bg-cyan-500/10' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>🛠 Biblioteca</button>
          <button onClick={() => setActivePanel('ia')} className={`flex-1 px-3 py-2.5 rounded-t-xl text-[10px] font-black uppercase tracking-widest transition-colors border-b-2 ${activePanel === 'ia' ? 'text-cyan-300 border-cyan-400 bg-cyan-500/10' : 'text-slate-500 border-transparent hover:text-slate-300'}`}>✦ Asistente IA</button>
        </div>

        {activePanel === 'tools' && (
          <div className="flex-grow overflow-y-auto px-4 py-4 space-y-2">
            <p className="text-[9.5px] text-slate-500 leading-relaxed px-1 pb-1">
              Extras y biblioteca. El flujo principal de modelado esta en la pestania "Flujo de trabajo" (izquierda).
            </p>

            <button onClick={handleReadModel} className="w-full bg-cyan-600/15 hover:bg-cyan-600/30 border border-cyan-500/30 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-cyan-300 transition-colors">Leer modelo abierto</button>

            <details className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[10px] font-black uppercase tracking-widest text-cyan-300 hover:bg-white/5">Grilla NO uniforme</summary>
              <div className="px-4 pb-4 pt-1">
                <p className="text-[9px] text-slate-600 mb-3 leading-relaxed">Ordenadas acumuladas: para separaciones 2 y 3 m escribe 0, 2, 5.</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Ordenadas X (m)</label><input value={nuGridParams.ordenadasX} onChange={e => setNuGrid('ordenadasX', e.target.value)} placeholder="0, 2, 5" className="w-full bg-black/40 border border-white/10 p-2 rounded-lg text-xs text-slate-200 font-mono outline-none focus:border-cyan-500" /></div>
                  <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Ordenadas Y (m)</label><input value={nuGridParams.ordenadasY} onChange={e => setNuGrid('ordenadasY', e.target.value)} placeholder="0, 5, 9" className="w-full bg-black/40 border border-white/10 p-2 rounded-lg text-xs text-slate-200 font-mono outline-none focus:border-cyan-500" /></div>
                  <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Pisos</label><input type="number" min="1" value={nuGridParams.numeroPisos} onChange={e => setNuGrid('numeroPisos', e.target.value)} className="w-full bg-black/40 border border-white/10 p-2 rounded-lg text-xs text-slate-200 font-mono outline-none focus:border-cyan-500" /></div>
                  <div><label className="text-[9px] text-slate-500 font-black uppercase block mb-1">Altura piso (m)</label><input type="number" step="0.05" value={nuGridParams.alturaPiso} onChange={e => setNuGrid('alturaPiso', e.target.value)} className="w-full bg-black/40 border border-white/10 p-2 rounded-lg text-xs text-slate-200 font-mono outline-none focus:border-cyan-500" /></div>
                </div>
                <div className="flex flex-col gap-2">
                  <button onClick={handleCreateNuGrid} disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 px-4 py-2.5 rounded-lg text-[10px] font-black uppercase text-white flex items-center justify-center gap-2 transition-colors"><Play size={13} /> Crear grilla no uniforme</button>
                  <button onClick={handleInsertNuGrid} className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-cyan-200 transition-colors">Insertar en editor</button>
                </div>
              </div>
            </details>

            <details open className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/5">Flujos guardados ({savedFlows.length})</summary>
              <div className="px-4 pb-4 pt-1">
                {savedFlows.length === 0 ? (
                  <p className="text-[9px] text-slate-600">Aun no hay flujos. Cuando algo funcione, pulsa "Guardar como flujo".</p>
                ) : (
                  <div className="space-y-2">
                    {savedFlows.map(flujo => (
                      <div key={flujo.id} className="flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-3 py-2 gap-2">
                        <div className="min-w-0 flex-grow"><div className="text-[10px] font-bold text-cyan-300 truncate">{flujo.nombre}</div><div className="text-[8px] text-slate-600">{flujo.fecha}</div></div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => handleRunFlow(flujo)} disabled={isLoading} className="bg-emerald-600/90 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wide flex items-center gap-1 transition-colors"><Play size={9} /> Ejecutar</button>
                          <button onClick={() => handleInsertFlow(flujo)} className="bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-200 px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wide transition-colors">Insertar</button>
                          <button onClick={() => handleDeleteFlow(flujo.id)} className="text-slate-600 hover:text-red-400"><X size={12} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <details className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[10px] font-black uppercase tracking-widest text-amber-300/90 hover:bg-white/5">Lecciones aprendidas ({savedLessons.length})</summary>
              <div className="px-4 pb-4 pt-1">
                {savedLessons.length === 0 ? (
                  <p className="text-[9px] text-slate-600 leading-relaxed">Al reparar un error y funcionar, el par error-solucion se guarda aqui y la IA lo recibe.</p>
                ) : (
                  <div className="space-y-2">
                    {savedLessons.slice().reverse().map(leccion => (
                      <div key={leccion.id} className="flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-3 py-2">
                        <div className="min-w-0"><div className="text-[10px] font-bold text-amber-300/90 truncate">{leccion.titulo}</div><div className="text-[8px] text-slate-600">{leccion.fecha}</div></div>
                        <button onClick={() => handleDeleteLesson(leccion.id)} className="text-slate-600 hover:text-red-400 shrink-0 ml-2"><X size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <details className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 text-[10px] font-black uppercase tracking-widest text-red-300/90 hover:bg-white/5">Mantenimiento ETABS</summary>
              <div className="px-4 pb-4 pt-1">
                <p className="text-[9px] text-slate-600 mb-3 leading-relaxed">Un proceso ETABS colgado da "Puntero no valido". Cierra los procesos aqui si pasa.</p>
                <div className="flex gap-2">
                  <button onClick={handleListEtabsProcesses} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-slate-300 transition-colors">Ver procesos</button>
                  <button onClick={handleCleanupEtabs} className="flex-1 bg-red-900/50 hover:bg-red-800 border border-red-500/30 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-red-200 transition-colors">Cerrar procesos</button>
                </div>
              </div>
            </details>
          </div>
        )}

        {activePanel === 'ia' && (
          <>
            <div className="px-5 py-3 bg-black/20 border-b border-white/5">
              <label className="flex items-center justify-between cursor-pointer select-none">
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">🔧 Modo agente</span>
                  <span className="text-[8.5px] text-slate-500">{config.agentMode ? 'usa herramientas (busca, lee, ejecuta con tu permiso)' : 'genera codigo que tu ejecutas'}</span>
                </span>
                <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${config.agentMode ? 'bg-cyan-500' : 'bg-slate-700'}`}>
                  <input type="checkbox" className="sr-only" checked={config.agentMode} onChange={e => setConfig({ ...config, agentMode: e.target.checked })} />
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${config.agentMode ? 'translate-x-4' : ''}`}></span>
                </span>
              </label>
              <div className="text-[9px] text-slate-500 mt-1.5">{config.agentMode ? `Agente con ${activeLabel} · ${aiTools.length} herramientas ETABS` : activeMode.label}</div>
            </div>

            <div className="flex-grow overflow-y-auto px-5 py-6 space-y-4">
              {messages.map((m, i) => (
                m.kind === 'tool' ? (
                  <div key={i} className="flex justify-start">
                    <div className={`max-w-[92%] w-full px-3 py-2 text-[10px] rounded-xl border ${m.estado === 'error' ? 'bg-red-500/5 border-red-500/25' : m.estado === 'cancelado' ? 'bg-slate-500/5 border-slate-500/25' : m.estado === 'pendiente' ? 'bg-amber-500/5 border-amber-500/25' : 'bg-cyan-500/5 border-cyan-500/20'}`}>
                      <div className="flex items-center gap-2 font-black uppercase tracking-wide text-[9px]">
                        <span>{m.estado === 'error' ? '⚠️' : m.estado === 'cancelado' ? '🚫' : m.estado === 'pendiente' ? '⏳' : '🔧'}</span>
                        <span className={m.estado === 'error' ? 'text-red-300' : m.estado === 'cancelado' ? 'text-slate-400' : m.estado === 'pendiente' ? 'text-amber-300' : 'text-cyan-300'}>{m.name}</span>
                        {m.estado === 'pendiente' && <span className="text-amber-400/70 normal-case font-bold">esperando confirmacion...</span>}
                      </div>
                      {m.resumen && <div className="text-slate-400 mt-1 leading-snug">{m.resumen}</div>}
                    </div>
                  </div>
                ) : (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[92%] px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap shadow-md ${m.role === 'user' ? 'bg-gradient-to-br from-cyan-600 to-cyan-700 text-white rounded-2xl rounded-br-md shadow-cyan-900/30' : 'bg-white/[0.04] text-slate-300 border border-white/10 rounded-2xl rounded-bl-md'}`}>{m.content}</div>
                  </div>
                )
              ))}
              {pendingTool && (
                <div className="anim-panel bg-amber-500/5 border border-amber-500/30 rounded-2xl p-4">
                  <div className="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1">⚠️ Confirmar accion en ETABS</div>
                  <div className="text-[10px] text-slate-300 mb-2">El asistente quiere ejecutar <span className="font-black text-amber-200">{pendingTool.name}</span>.</div>
                  {pendingTool.name === 'ejecutar_script_etabs' && pendingTool.arguments?.codigo && (
                    <pre className="text-[8.5px] font-mono text-slate-400 bg-black/40 rounded-lg p-2 max-h-44 overflow-y-auto mb-2 whitespace-pre-wrap">{String(pendingTool.arguments.codigo).slice(0, 2000)}</pre>
                  )}
                  {pendingTool.name === 'ejecutar_flujo' && <div className="text-[10px] text-slate-400 mb-2">Flujo: <span className="font-bold text-slate-200">{pendingTool.arguments?.nombre}</span></div>}
                  {pendingTool.name === 'cerrar_procesos_etabs' && <div className="text-[10px] text-red-300 mb-2">Cerrara TODOS los procesos de ETABS (se pierde lo no guardado).</div>}
                  <div className="flex gap-2">
                    <button onClick={() => resolverConfirmacion(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide">Ejecutar en ETABS</button>
                    <button onClick={() => resolverConfirmacion(false)} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wide">Cancelar</button>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-5 bg-black/20 border-t border-white/5">
              <div className="flex items-center bg-[#11141c] rounded-2xl p-1.5 border border-white/10 focus-within:border-cyan-500/50 transition-colors shadow-inner">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleChat(); }} placeholder={config.agentMode ? 'Ej: revisa las derivas del modelo y dime si cumple...' : 'Ej: crea una grilla 4x4 de 8 m...'} className="flex-grow bg-transparent px-3.5 py-2.5 text-xs outline-none placeholder:text-slate-600" />
                <button onClick={handleChat} disabled={isLoading} className="p-2.5 bg-gradient-to-br from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 disabled:from-slate-700 disabled:to-slate-700 text-white rounded-xl shadow-lg shadow-cyan-500/20 disabled:shadow-none transition-all"><Send size={16} /></button>
              </div>
            </div>
          </>
        )}
      </aside>

      {isSettingsOpen && (
        <div className="anim-panel absolute top-20 right-[470px] w-[460px] bg-[#0d1017]/95 backdrop-blur-xl border border-white/10 ring-1 ring-cyan-500/10 rounded-2xl p-8 shadow-2xl shadow-black/60 z-50 max-h-[82vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xs font-black text-cyan-400 uppercase flex items-center gap-2"><Cpu size={14} /> Configuracion</h3>
            <button onClick={() => setIsSettingsOpen(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] text-cyan-400 font-black uppercase block mb-2">Motor activo</label>
                <select value={config.aiProvider} onChange={e => setConfig({ ...config, aiProvider: e.target.value })} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300">
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </select>
              </div>
              <div>
                <label className="text-[9px] text-cyan-400 font-black uppercase block mb-2">Modelo activo</label>
                <div className="w-full bg-cyan-900/20 border border-cyan-500/30 p-3 rounded-xl text-xs font-bold text-cyan-300 truncate">{activeModel || 'Sin modelo'}</div>
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-slate-800/50 border-cyan-500/30">
              <label className="text-[10px] text-cyan-400 font-black uppercase block mb-2">Modelo Gemini</label>
              <select value={getSelectedModelValue('gemini', config)} onChange={e => setConfig({ ...config, geminiModel: e.target.value === 'custom' ? config.customGeminiModel || 'gemini-2.5-flash' : e.target.value })} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300 mb-2">
                {GEMINI_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-[9px] text-slate-500 mb-3">{getModelHint('gemini', config)}</div>
              {getSelectedModelValue('gemini', config) === 'custom' && <input value={config.customGeminiModel} onChange={e => setConfig({ ...config, customGeminiModel: e.target.value, geminiModel: e.target.value })} placeholder="Ej: gemini-2.5-flash" className="w-full bg-cyan-900/20 border border-cyan-500/30 p-3 rounded-xl text-xs text-cyan-200 mb-2" />}
              <label className="text-[9px] text-slate-400 font-black uppercase flex items-center gap-1 mt-4 mb-2"><Key size={10} /> Llaves Gemini</label>
              <textarea rows="3" value={config.geminiApiKeys} onChange={e => setConfig({ ...config, geminiApiKeys: e.target.value })} placeholder="AIzaSy..." className="w-full bg-black/60 border border-white/10 p-3 rounded-lg text-xs text-white font-mono resize-none" />
              <div className="mt-3 flex justify-between items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-1 rounded ${geminiKeys.length ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{geminiKeys.length} llaves listas</span>
                <div className="flex gap-2">
                  <button onClick={handleTestAiModel} className="bg-cyan-700 hover:bg-cyan-600 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-white">Test modelo</button>
                  <button onClick={handleListModels} className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-slate-200">Listar disponibles</button>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-slate-800/50 border-emerald-500/30">
              <label className="text-[10px] text-emerald-400 font-black uppercase block mb-2">Modelo OpenAI</label>
              <select value={getSelectedModelValue('openai', config)} onChange={e => setConfig({ ...config, openaiModel: e.target.value === 'custom' ? config.customOpenaiModel || 'gpt-4.1-mini' : e.target.value })} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300 mb-2">
                {OPENAI_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-[9px] text-slate-500 mb-3">{getModelHint('openai', config)}</div>
              {getSelectedModelValue('openai', config) === 'custom' && <input value={config.customOpenaiModel} onChange={e => setConfig({ ...config, customOpenaiModel: e.target.value, openaiModel: e.target.value })} placeholder="Ej: gpt-4.1-mini" className="w-full bg-emerald-900/20 border border-emerald-500/30 p-3 rounded-xl text-xs text-emerald-200 mb-2" />}
              <label className="text-[9px] text-slate-400 font-black uppercase flex items-center gap-1 mt-4 mb-2"><Key size={10} /> Llaves OpenAI</label>
              <textarea rows="3" value={config.openaiApiKeys} onChange={e => setConfig({ ...config, openaiApiKeys: e.target.value })} placeholder="sk-proj-..." className="w-full bg-black/60 border border-white/10 p-3 rounded-lg text-xs text-white font-mono resize-none" />
              <div className="mt-3 flex justify-between items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-1 rounded ${openaiKeys.length ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{openaiKeys.length} llaves listas</span>
                <div className="flex gap-2">
                  <button onClick={handleTestAiModel} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-white">Test modelo</button>
                  <button onClick={handleListModels} className="bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-[9px] font-black uppercase text-slate-200">Listar disponibles</button>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border bg-slate-800/50 border-orange-500/30">
              <label className="text-[10px] text-orange-400 font-black uppercase block mb-2">Modelo Claude (Anthropic)</label>
              <select value={getSelectedModelValue('anthropic', config)} onChange={e => setConfig({ ...config, anthropicModel: e.target.value === 'custom' ? config.customAnthropicModel || 'claude-fable-5' : e.target.value })} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300 mb-2">
                {ANTHROPIC_MODEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="text-[9px] text-slate-500 mb-3">{getModelHint('anthropic', config)}</div>
              {getSelectedModelValue('anthropic', config) === 'custom' && <input value={config.customAnthropicModel} onChange={e => setConfig({ ...config, customAnthropicModel: e.target.value, anthropicModel: e.target.value })} placeholder="Ej: claude-fable-5" className="w-full bg-orange-900/20 border border-orange-500/30 p-3 rounded-xl text-xs text-orange-200 mb-2" />}
              <label className="text-[9px] text-slate-400 font-black uppercase flex items-center gap-1 mt-4 mb-2"><Key size={10} /> Llaves Claude</label>
              <textarea rows="2" value={config.anthropicApiKeys} onChange={e => setConfig({ ...config, anthropicApiKeys: e.target.value })} placeholder="sk-ant-..." className="w-full bg-black/60 border border-white/10 p-3 rounded-lg text-xs text-white font-mono resize-none" />
              <div className="mt-3 flex justify-between items-center gap-2">
                <span className={`text-[9px] font-bold px-2 py-1 rounded ${anthropicKeys.length ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{anthropicKeys.length} llaves listas</span>
                <span className="text-[8.5px] text-slate-500">Va por el servidor local (evita CORS). Ideal para el modo agente.</span>
              </div>
            </div>

            <div className="pt-2 border-t border-white/5 space-y-4">
              <div>
                <label className="text-[10px] text-slate-400 font-black uppercase block mb-2">Servidor Python local</label>
                <input value={config.pythonUrl} onChange={e => setConfig({ ...config, pythonUrl: e.target.value })} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300 font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-black uppercase block mb-2">Unidades sugeridas</label>
                <input value={selectedUnits} onChange={e => setSelectedUnits(e.target.value)} className="w-full bg-black/40 border border-white/5 p-3 rounded-xl text-xs text-slate-300 font-mono" />
                <div className="text-[9px] text-slate-500 mt-1">8 = kgf, m, C (recomendado). Materiales/secciones se definen internamente en kgf-cm (14). 6 = kN, m.</div>
              </div>
              <div className="text-[9px] text-slate-500 leading-relaxed bg-black/30 rounded-lg p-3 border border-white/5">
                El codigo se ejecuta como script completo (igual que en cmd). Usa "Guardar .py" para descargarlo y correrlo manualmente con: python etabs_script.py
              </div>
            </div>
          </div>
        </div>
      )}

      {isDocsOpen && (
        <div className="anim-panel absolute top-20 right-[470px] w-[560px] bg-[#0d1017]/95 backdrop-blur-xl border border-white/10 ring-1 ring-cyan-500/10 rounded-2xl p-8 shadow-2xl shadow-black/60 z-50 max-h-[82vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xs font-black text-cyan-400 uppercase flex items-center gap-2"><CheckCircle2 size={14} /> Contexto API ETABS</h3>
            <button onClick={() => setIsDocsOpen(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
          </div>

          <div className="mb-5 p-4 bg-black/40 border border-cyan-500/20 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-cyan-400 font-black uppercase">Buscar en documentacion oficial (ETABS 22)</label>
              <a href={`${config.pythonUrl}/explorer`} target="_blank" rel="noopener noreferrer" className="bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase text-white no-underline">Abrir Explorador completo</a>
            </div>
            <div className="flex gap-2">
              <input value={docSearchQuery} onChange={e => setDocSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleDocSearch(); }} placeholder="Ej: crear viga, NewGridOnly, unidades, material..." className="flex-grow bg-black/50 border border-white/10 px-3 py-2 rounded-lg text-[11px] font-mono text-slate-200 outline-none focus:border-cyan-500" />
              <button onClick={handleDocSearch} className="bg-cyan-700 hover:bg-cyan-600 px-4 py-2 rounded-lg text-[9px] font-black uppercase text-white">Buscar</button>
            </div>
            {docSearchMsg && <div className="mt-3 text-[10px] text-slate-400">{docSearchMsg}</div>}
            {docSearchItems.length > 0 && (
              <div className="mt-2 max-h-80 overflow-y-auto space-y-2 pr-1">
                {docSearchItems.map((item, i) => (
                  <div key={i} className="bg-black/50 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="text-[11px] font-bold text-cyan-300 truncate">{item.title}</div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[8px] font-black uppercase tracking-wider bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-slate-400">{item.kind}</span>
                        {(item.kind === 'method' || item.kind === 'property' || item.kind === 'enum') && (
                          <button onClick={() => handleInsertDocTemplate(item)} className="bg-cyan-600/90 hover:bg-cyan-500 text-white px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wide transition-colors">Insertar plantilla</button>
                        )}
                      </div>
                    </div>
                    {item.signature && <pre className="text-[9.5px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed bg-black/40 rounded-lg p-2 border border-white/5">{item.signature}</pre>}
                    {item.remarks && <div className="text-[9px] text-amber-200/70 mt-1.5 leading-relaxed">{item.remarks.slice(0, 220)}</div>}
                    {item.example && (
                      <details className="mt-1.5">
                        <summary className="text-[9px] text-emerald-300/80 cursor-pointer font-bold">Ver ejemplo oficial (C#/VB)</summary>
                        <pre className="text-[9px] text-slate-400 whitespace-pre-wrap font-mono mt-1 bg-black/40 rounded-lg p-2 border border-white/5">{item.example}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="text-[9px] text-slate-600 mt-2">Esta misma busqueda se hace automaticamente con cada instruccion que le das a la IA.</div>
          </div>

          <textarea rows="18" value={config.documentationContext} onChange={e => setConfig({ ...config, documentationContext: e.target.value })} className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-slate-200 outline-none focus:border-cyan-500 resize-none leading-relaxed" />
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setConfig(prev => ({ ...prev, documentationContext: DEFAULT_API_CONTEXT }))} className="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-slate-200">Restaurar base</button>
            <button onClick={() => setIsDocsOpen(false)} className="bg-cyan-600 hover:bg-cyan-500 px-4 py-2 rounded-lg text-[10px] font-black uppercase text-white">Guardar contexto</button>
          </div>
        </div>
      )}

      {status.message && (
        <div className={`anim-toast fixed top-8 left-1/2 px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold flex items-center gap-2.5 z-[900] border backdrop-blur-xl ${status.type === 'error' ? 'bg-red-950/90 border-red-500/40 text-red-200 shadow-red-900/40' : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200 shadow-emerald-900/40'}`}>
          {status.type === 'error' ? <AlertCircle size={15} className="text-red-400 shrink-0" /> : <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />}
          {status.message}
        </div>
      )}

      {isLoading && !pendingTool && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[800] flex items-center justify-center">
          <div className="anim-panel bg-[#0d1017]/95 border border-white/10 ring-1 ring-cyan-500/20 rounded-3xl px-10 py-8 shadow-2xl flex flex-col items-center gap-5">
            <div className="relative w-14 h-14">
              <div className="spin-ring absolute inset-0 rounded-full border-[3px] border-cyan-500/15 border-t-cyan-400"></div>
              <Zap size={22} className="text-cyan-300 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <div className="font-black text-cyan-300 tracking-[0.25em] text-sm uppercase">Procesando</div>
              <div className="text-[10px] text-slate-500 mt-1.5">Generando o ejecutando en ETABS...</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
