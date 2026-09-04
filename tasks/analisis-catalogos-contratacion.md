# Análisis — Catálogos de contratación (previo al modelado)

Fecha: 2026-09-03 · Fuentes: `Catálogos de tipos contratacion.xlsx` (hojas *tipos de contratacion* y *concepto_contratacion*)

> Tarifas queda fuera de alcance por indicación explícita. Este análisis cubre
> **tipo de contratación → conceptos** y sienta la base para **tipo de contratación → documentos**.

---

## 1. Qué contienen los archivos

| Archivo | Filas | Grano |
|---|---|---|
| `tipos de contratacion` | 170 | un tipo de contratación por administración |
| `concepto_contratacion` | 2 420 | par (tipo de contratación × concepto) |

El tercer CSV recibido es **idéntico** al segundo (mismo MD5) — es una copia, no un archivo nuevo.

**El cruce es perfecto:** los 170 `tctcod` de la primera hoja aparecen los 170 en la segunda, sin
huérfanos en ninguna dirección y sin una sola discrepancia de nombre. Los archivos son consistentes
entre sí y se pueden importar con un solo join.

---

## 2. Hallazgo central: 170 tipos son en realidad 32

Hay **170 identificadores** pero solo **32 nombres lógicos** de tipo de contratación. El mismo tipo
—por ejemplo `ALTA NUEVA COMERCIAL`— existe 13 veces, una por administración, cada una con su
propio `tctcod`.

Hydra hoy replica esa desnormalización: `TipoContratacion` tiene una fila por combinación. Eso trae
tres consecuencias concretas:

1. **No existe el tipo lógico como entidad.** No hay forma de expresar "todos los ALTA NUEVA
   COMERCIAL", así que cualquier cambio de política se aplica a mano 13 veces — el mismo problema
   que CEA describió con las tarifas (cuatro días de trabajo manual con margen de error).
2. **El dropdown muestra 170 opciones** donde conceptualmente hay 32, con nombres repetidos.
3. **Dar de alta una administración** obliga a crear 32 tipos uno por uno.

---

## 3. La variación por administración es legítima, no data sucia

De los 32 tipos lógicos, **17 tienen distinto conjunto de conceptos según la administración**
(hasta 9 variantes distintas en `ALTA NUEVA PUBLICO OFICIAL`). La primera reacción sería
normalizarlo como error de captura. **Sería un error hacerlo.**

Cada tipo tiene un **núcleo estable** de 9 a 14 conceptos presentes en todas sus administraciones,
más 1 a 10 conceptos que entran y salen. Y los que varían tienen una explicación operativa clara:

| Concepto que varía | En cuántos tipos | Por qué varía |
|---|---|---|
| `ALCANTARILLADO (CONTRATACION)` | 9 | no todas las zonas tienen red de drenaje |
| `INSPECCIÓN CONDOMINAL` | 9 | depende de la operación local |
| `INSPECCIÓN INTRADOMICILIARIA INDIVIDUAL` | 8 | ídem |
| `DERECHOS DE CONEXIÓN RED DE DRENAJE` | 7 | infraestructura de drenaje |
| `DERECHOS DE INFRAESTRUCTURA RED TRATAMIENTO` | 6 | existencia de planta de tratamiento |
| `CARTA DE FACTIBILIDAD` | 6 | requisito local |

**Conclusión: la administración es una dimensión real del mapeo y hay que conservarla.** Colapsar a
tipo lógico perdería 1 906 de 2 420 filas y facturaría drenaje en zonas que no lo tienen.

---

## 4. Data sucia encontrada

- `ALTA NUEVA DOMESTICO ECONOMICO` y `ALTA NUEVA DOMESTICO ECONÓMICO` son el **mismo tipo partido en
  dos por un acento** (9 administraciones en una grafía, 4 en la otra). Se unifican al normalizar,
  pero hay que confirmarlo con CEA antes de fusionarlos.
- La columna `tipo_documento_alta` es **constante**: `ContratoSuministro`, 2 copias, en las 170 filas.
  No aporta información y **no es el catálogo de documentos** — es el formato que imprime el sistema
  al dar de alta, no lo que entrega el ciudadano.

---

## 5. Modelo propuesto

```
CatalogoAdministracion (13)
CatalogoConcepto       (25)        ← los 25 conceptos distintos, con su naturaleza
CatalogoDocumento      ( ? )       ← FALTA EL ARCHIVO

TipoContratacionBase   (32)        ← el tipo lógico: código canónico, clase, uso, requiereMedidor
  └── TipoContratacion (170)       ← instancia por administración; conserva el codigo TCT-xxx de SIGE
        ├── ConceptoTipoContratacion   (2 420)   qué se cobra
        └── DocumentoTipoContratacion  (   ? )   qué se entrega
```

**Lo que resuelve `TipoContratacionBase`:** da existencia al tipo lógico sin perder la variación por
administración. El dropdown puede agrupar por base, las políticas se aplican por base, y la
instancia sigue siendo la unidad operativa.

**`TipoContratacion` conserva su `codigo` TCT-xxx** — los contratos existentes lo referencian y el
importer hace upsert por esa clave natural. Es una refactorización aditiva, no rompe nada.

### Decisión abierta: cómo guardar el mapeo de conceptos

| Opción | Filas | A favor | En contra |
|---|---|---|---|
| **Plano por instancia** *(recomendada)* | 2 420 | cada fila es una decisión explícita y auditable; "¿qué cobra esta admin?" es un SELECT directo; es el nivel al que CEA opera | un cambio global toca 13 filas — se resuelve con una operación bulk en el API, no en el modelo |
| Núcleo en la base + overrides | ~900 | un cambio global es una sola fila | para saber qué cobra una administración hay que resolver herencia; auditoría más difícil de explicar |

Recomiendo **plano**. 2 420 filas no es un problema de escala, y la elasticidad que se busca la da
la operación masiva, no la herencia. Una capa de resolución añade complejidad justo donde CEA
necesita poder responder "¿por qué me cobraron esto?" con una sola consulta.

**No hace falta vigencia en el mapeo:** `ContratoConcepto` ya guarda el snapshot de lo que se le
cobró a cada contrato, así que quitar un concepto de un tipo no afecta al histórico.

---

## 6. CSV de documentos (recibido 2026-09-03, análisis posterior)

`documento.csv`: 4 080 filas, 24 documentos distintos (`dconid`), cruce perfecto con los 170
`tctcod`. **Pero el mapeo está degenerado: los 170 tipos tienen exactamente el mismo set de 24
documentos.** Es un producto cartesiano — SIGE nunca configuró qué documento aplica a qué tipo
(«ALTA NUEVA AGUA TRATADA» requiere hasta el formato de baja definitiva).

Consecuencias:
- El **catálogo** de 24 documentos sí es información válida → se importa (`CatalogoDocumento`),
  con la presentación (ORIGINAL/COPIA) separada del nombre.
- La **relación** tipo→documento no existe en ninguna fuente → la cura CEA vía API/UI.
  No se siembra el producto cartesiano.
- Cada documento lleva clasificación semántica (COMUN, PERSONA_MORAL, REPRESENTACION, CONDOMINAL,
  HIDRANTE, FACTIBILIDAD, REGULARIZACION, BAJA, OTRO) para agrupar los dropdowns — pendiente de
  validación con CEA.
- La relación lleva `aplicaUso` (domestico | no_domestico | null) para expresar la ramificación
  del árbol por uso, y hay endpoint de asignación masiva para la elasticidad.

## 7. Qué falta para poder construir

1. Que **CEA cure el mapeo** tipo→documento (no existe en SIGE; el CSV es producto cartesiano).
2. **Validar con CEA** la fusión de `DOMESTICO ECONOMICO` / `DOMESTICO ECONÓMICO`.
3. **Confirmar la naturaleza de cada uno de los 25 conceptos** — cuáles son cobro, cuáles requisito
   documental (`CARTA DE FACTIBILIDAD` parece requisito, no cobro) y cuáles orden de trabajo
   (`INSTALACIÓN DE MEDIDOR`). El dropdown correcto depende de esa clasificación.

## 8. Análisis del xlsx completo (2026-09-03, 12 hojas)

Fuente: `~/Desktop/Catálogos de tipos contratacion.xlsx`. Hojas ya conocidas: tipos (×2), administracion,
clase_contratacion, tipo_punto_serv, estructura_tecnica, concepto_contratacion, documento. **Hallazgos nuevos:**

### La relación documento↔tipo NO existe tampoco en el xlsx
La hoja `documento` (4,080 filas) es el mismo producto cartesiano: 1 solo set de 24 documentos para
los 170 tipos. Confirmado: esa relación no existe en ninguna fuente SIGE → la propuesta + validación
CEA sigue siendo el único camino.

### Hojas nuevas con información REAL
1. **`clausulas`** (5,309 filas): 125 cláusulas distintas CON TEXTO completo, 21–32 por tipo,
   7 sets distintos → relación real tipo↔cláusula. El schema ya tiene `ClausulaContractual` +
   `ClausulaTipoContratacion`: importable ya. Arma el contrato impreso por tipo.
2. **`concepto_lecturas`** (344 filas): conceptos PERIÓDICOS (facturación por lecturas) por tipo:
   - 100 tipos: AGUA + SANEAMIENTO (sin alcantarillado — zonas sin red, consistente con la junta)
   - 35 tipos: AGUA + ALCANTARILLADO + SANEAMIENTO · 32: solo AGUA · especiales: pipas/pozo/agua tratada
   - AGUA lleva su **tarifa asignada** (14 tarifas = enlaza con ClaseTarifa/tcttpsid)
3. **`Cat conceptos contrat`** (21 conceptos, `tconid` SIGE): **clasificación fiscal real por concepto**:
   - AGUA, ALCANTARILLADO, SANEAMIENTO, DERECHOS DE CONTRATACIÓN: ambas tasas (16 y 0) → depende del uso
   - MULTA y RECARGOS: **No Objeto** de IVA (ni 16 ni 0 — fuera del objeto del impuesto)
   - resto: solo 16 %
4. `tipo_documento`: plantillas de impresión OM/sms/email (ContratoSuministro…) — no es catálogo ciudadano.

### Import pendiente que esto habilita
- Conceptos: catálogo real (21, con tconid y fiscal) + relación contratación (2,420) + relación
  lecturas (344 con tarifa) → puebla `ConceptoCobro`/`ConceptoCobroTipoContratacion`
- Cláusulas: 125 + ~5,300 vínculos → puebla `ClausulaContractual`/`ClausulaTipoContratacion`
