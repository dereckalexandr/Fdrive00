# Levantamiento: módulo de transferencias digitales de vehículos

Fecha: 6 de noviembre de 2026 · Referencia: Autofact Pro (`autofactpro.com/cl`, flujo `transferencia/completar/TRF…`) y Autofact (`autofact.cl/transferencias`).

## 1. Qué se pudo observar y qué no

**Observado (páginas públicas):**
- `autofactpro.com/cl`: portada de acceso para clientes (inicio de sesión con Microsoft o con cuenta Autofact) y descripción de sus productos: Informe Autofact, Transferencias digitales, Limpieza de multas y Retomas.
- `autofactpro.com/transferencias-digitales-vehiculos`: descripción del flujo para automotoras.
- `autofact.cl/transferencias/automotoras` y `autofact.cl/transferencias?activeTab=trackingTrf`: precio, pasos, antifraude, seguimiento y calculadora de costos.

**Observado con la sesión iniciada por el usuario (solo lectura, 6 de noviembre de 2026):** el listado de transferencias de la automotora, el glosario de estados, la pantalla `transferencia/completar/TRF…` de un contrato en estado CREADO, la ficha `transferencia/ver/TRF…` de un contrato aprobado (documentos y actividad) y la calculadora de costos. No se ingresó ninguna credencial, no se creó ni se guardó nada y no se pulsó ningún botón que modifique datos. Los datos de personas que aparecen en esas pantallas no se copian a este documento: solo se registra la estructura.

**No observado:** los pasos 2 a 4 del asistente (se ven los campos en la página pero no se avanzó), la pantalla de firma del cliente, el flujo «Agregar comprador», el pago y las preguntas frecuentes de Autofact (plegadas). Quedan para la sección 12.

## 2. Cómo funciona el sistema de referencia

Según la descripción pública de Autofact:

1. **La automotora se inscribe** con Autofact, sin requisitos ni firma de contratos, y prepaga lo que necesite.
2. **Se crea el contrato de compraventa 100% electrónico** en la plataforma. El comprador y el vendedor completan los datos del contrato y de los documentos.
3. **Firma electrónica avanzada del cliente**, desde cualquier lugar (no hace falta estar en la sala de ventas).
4. **La automotora revisa y aprueba en línea** la documentación y, si el contrato es a nombre de la automotora, firma el **representante legal**.
5. **Autofact gestiona** el pago de impuestos (Tesorería), la **firma avanzada del notario** y el envío al Registro Civil para la inscripción.
6. **Autofact adjunta al contrato** el CAV a nombre del nuevo propietario y la solicitud de transferencia.
7. **Seguimiento en tiempo real** del trámite. La finalización depende de las instituciones oficiales.

**Para clientes sin cuenta de empresa** (`autofact.cl/transferencias`): basta que una de las dos partes inicie el trámite con la patente, su correo y si es comprador o vendedor. Luego ambas partes completan datos. Se consulta el estado con **patente + correo**.

**Controles de seguridad que anuncian:** verificación de identidad con **Clave Única** y **reconocimiento facial**, y un sistema antifraude propio.

**Reglas visibles de rechazo:**
- Si una de las partes es deudora de pensión de alimentos, se rechaza la transferencia (Ley 21.389).
- Si una parte es extranjera y su cédula está vencida, debe presentar el comprobante digital de permanencia vigente.

**Costos:** el servicio se divide en costo base, arancel e impuesto, y tienen una calculadora con el valor de venta o la tasación fiscal. Para automotoras: desde **$28.000 + IVA** por transferencia, más aranceles e impuestos, con prepago y sin cargos fijos. Otras ofertas que ofrecen durante el trámite: TAG a domicilio y seguro automotriz.

## 2b. Hallazgos de la plataforma autenticada (Autofact Pro)

**Lo más importante:** la automotora ya usa Autofact Pro para transferir (hay decenas de contratos creados por el equipo). Autofact es quien firma con el notario, paga el impuesto y tramita en el Registro Civil. Por eso el módulo del CRM no tiene que reemplazar esa tramitación: debe **ordenar, controlar y dar seguimiento** a lo que ya se hace allá, y preparar los datos y documentos desde el CRM.

**Tipos de contrato (columna «TC»):**
- **Contrato abierto (CA):** «el cliente deja el vehículo en la automotora, el cual posteriormente es transferido a un nuevo propietario distinto del concesionario». Es el caso de toma o consignación: el dueño firma un mandato y después se **agrega el comprador**. Es lo que más usa el equipo.
- **Contrato cerrado (AV en la lista):** venta directa en que la automotora actúa como parte, con firma del representante legal. En la lista aparece como «AV»; el significado exacto de la sigla no está explicado en pantalla (por confirmar).

**Panel de transferencias:**
- Pestañas: Mis contratos, Mis rechazos, Derivados, Consultar todos, Pendiente de pago.
- Columnas: TC, derivado, factura, patente, marca · modelo · año, creador, fecha de creación, servicios adicionales (por ejemplo TAG), ver y estado.
- Acciones: crear contrato, filtros, descargar listado rápido, solicitar listado histórico, descargar Excel de fechas, glosario de estados y descarga de declaraciones juradas.
- Saldo de paquetes (informes, «Solo CAV» y certificados de multas) con recarga, y usuarios con permisos por persona.

**Glosario de estados de Autofact (38):** se agrupan en etapas.
- **Creación y firma:** Creado · Verificación contrato · Revisión firma · Firma cliente · Firma mandato · Firma Autofact · Esperando firma.
- **Aprobación de la automotora:** Aprobación toma · Aprobación venta · Aprobado (contrato abierto listo para agregar comprador) · A-Creado (el comprador aún completa sus datos).
- **Revisión previa:** Esperando informe · Revisión · Revisión aprobación · En evaluación · Gestión · Gestión de facturas.
- **Pago:** Pendiente pago (Registro Civil e impuesto, a cargo de la automotora).
- **Tramitación:** Notario · Legalización docs · Ingresado STEV / Pre transferido (ingresado al Registro Civil) · Manual (por ventanilla, 10 a 15 días hábiles).
- **Restricciones y rechazos:** E. restricción · Alzamiento · Rechazó notario · Rechazo RC · Gestión rechazo RC · Control rechazo RC · Reingresado a RC · Corrección RS.
- **Cierre:** Transferido (con el CAV a nombre del nuevo dueño) · Archivado · Anulación forzada por T&C · Anulación/devolución forzada por T&C.

**Asistente «Completar» (4 pasos), paso 1 de un contrato abierto:**
- *Vendedor:* nombre, primer y segundo apellido, región, comuna, calle, número, resto de dirección, correo (obligatorio) y celular.
- *Declaración jurada PEP* del vendedor (Sí/No: persona expuesta políticamente o con vínculo familiar).
- *Vehículo:* número de chasis, número de motor, kilometraje, **permiso de circulación (archivo)**, fecha de expiración y comuna del permiso.
- *Tasación fiscal:* se elige la tasación del SII (año, marca, modelo, cilindrada, transmisión y combustible) y se completan el código SII, la tasación y el **impuesto a la transferencia**.
- *Resto del asistente (visible en la página, no recorrido):* datos del vehículo (usado, nuevo o «nada» como forma de pago con otro vehículo en parte de pago: patente, dígito verificador, kilometraje, marca, modelo, año, tipo, color, chasis, motor y precio), **empresa o persona representada** (RUT, razón social) y **representantes con poder** (RUT, nombres, fecha del poder, notario, notaría y comuna).
- Botones: Guardar, Siguiente, Volver, y eliminar con confirmación escribiendo «eliminar».

**Ficha del contrato aprobado:**
- Botones: Agregar comprador, Rechazar, y un enlace para copiar y compartir con el comprador el seguimiento en tiempo real.
- Documentos: Contrato, CAV, Certificado de multas, Permiso de circulación (con vencimiento), Cédula del vendedor, Firma del vendedor, Mandato del comprador, Paquete de mandato del vendedor y **Formulario V6**. Cada uno con fecha y botón «Actualizar». Se pueden adjuntar otros y hay documentos internos no obligatorios (Carta de instrucción).
- Informe Autofact de la patente con indicadores (MU, LD, ER, RT, FV, PT).
- Pestaña **Actividad**: bitácora de cambios de estado y aprobaciones con quién y cuándo (por ejemplo «Contrato aprobado, incluye firma con clasificación B»).
- Aviso permanente de la Ley 21.389 (deudores de pensión de alimentos): hay que preguntar a las partes antes de transferir.

**Cumplimiento y seguridad:**
- Aceptación de «Responsabilidad de entrega de datos» al iniciar cada proceso (el usuario declara que la información es fidedigna).
- **Declaraciones juradas PEP y de origen de fondos (DOF, sobre 10.000 USD)** descargables por rango de hasta 6 meses, para el Reporte de Operaciones en Efectivo ante la UAF.
- **Desde el 1 de noviembre de 2026** cambió la verificación de identidad para la firma electrónica avanzada (Resolución N.º 733 del Ministerio de Economía y Ley de Protección de Datos).

**Costos (calculadora pública, ejemplo con un vehículo de $10.000.000):** costo base del servicio $59.990 (incluye validación del contrato y firma digital; se paga al inicio), arancel estatal $39.240 (se paga cuando el contrato está listo) e **impuesto del 1,5% sobre el mayor valor entre el precio de venta y la tasación fiscal** ($150.000). Total $249.230. Para automotoras el precio base publicado es desde $28.000 + IVA, con prepago.

## 3. Lo que ya existe en el CRM y se puede reutilizar

| Necesidad | Ya existe |
|---|---|
| Venta cerrada y aprobada (el punto de partida natural) | Cierres de venta con estados, aprobación del Jefe Local, precio final, cliente y vehículo (`cierres`, `crm-cierres.jsx`) |
| Compras y consignaciones (transferencias hacia la automotora) | `compras` y `consignaciones` con sus estados y validación de documentos |
| Documentos con archivos, revisión y aprobación | Validaciones (`validaciones`, `validacion_docs`, archivos en `kv_store` como `dval::…`) y el perfil Validador |
| Documentos del vehículo (multas, informe legal, permiso, revisión técnica, SOAP) | `DOCS_VEHICULO` y `DOCS_COMPRA` en `validaciones-core.js` |
| Datos del vehículo por patente (marca, modelo, año, motor) | Consulta Boostr (`patentes.ts`) |
| Lectura del CAV | `cav-parser.js`, `cav-fields.js` |
| Contrato en texto y PDF | `contrato-consignacion-core.js` (borrador sin razón social ni RUT de la automotora) y `pdf-report.js` |
| Datos del cliente y del dueño (RUT, cuenta, dirección) | Clientes, leads y `DatosDelDueno` |
| Roles, permisos y bitácora | `crm-core.js` (permisos por rol y por persona) y auditoría |
| Avisos por correo | `correo.ts` (Resend) |
| Consulta pública sin sesión, con captcha y acceso firmado | `publico.ts` y el sitio de inspecciones (sirve de modelo para la consulta de estado) |
| Costos de transferencia | No existe. Habría que agregar una calculadora (impuesto + arancel + honorario) |

## 4. Lo que falta (brechas)

1. **Contrato de compraventa** generado por el sistema (hoy solo se sube como documento y existe un borrador de consignación).
2. **Firma electrónica avanzada** de las partes, del representante legal y del notario.
3. **Verificación de identidad** (Clave Única, reconocimiento facial).
4. **Tramitación ante instituciones oficiales:** pago de impuestos en Tesorería, notaría y solicitud de inscripción en el Registro Civil.
5. **Módulo de transferencias** con estados, tareas y seguimiento.
6. **Consulta pública de estado** (patente + correo) y portal para que comprador y vendedor completen sus datos.
7. **Prepago y cobro** de aranceles, impuestos y honorarios.
8. **Datos de la empresa** (razón social, RUT, representante legal) para el contrato.

## 5. Dependencias externas y qué es viable construir

Las piezas 2, 3 y 4 **no se pueden construir solo con software propio**: requieren proveedores o convenios que hay que decidir antes de programar.

| Pieza | Qué se necesita | Estado |
|---|---|---|
| Firma electrónica avanzada | Un proveedor acreditado de firma avanzada, con costo por firma | Por definir |
| Verificación de identidad | Clave Única (convenio con el Estado) y/o un proveedor de biometría facial | Por definir |
| Notario con firma digital | Convenio con una o más notarías que acepten el flujo digital | Por definir |
| Pago de impuestos y arancel | Pago ante Tesorería y Registro Civil; hoy es manual o vía un gestor | Por definir |
| Inscripción de la transferencia | Solicitud al Registro de Vehículos Motorizados | Por definir |

**Tres caminos posibles:**

- **A. Gestor de transferencias que delega en Autofact.** El CRM crea la transferencia, junta los datos y los documentos, y hace el seguimiento; Autofact firma y tramita. Es lo más rápido y barato de construir, pero depende de que Autofact acepte e idealmente ofrezca una API (**no verificado**). Sin API, el CRM solo registraría el estado a mano.
- **B. Plataforma propia completa.** El CRM genera el contrato, toma la firma con un proveedor de firma avanzada, valida identidad y gestiona con notaría y Registro Civil. Es el sistema equivalente al de Autofact, pero requiere contratos con terceros y un componente legal fuerte. Es la opción de mayor costo y plazo.
- **C. Híbrida por fases (elegida por el usuario el 6 de noviembre de 2026).** Se parte con el gestor interno que sigue lo que ya se tramita en Autofact, y se agrega el contrato propio, la firma y la identidad solo si hay proveedor y decisión.

## 6. Modelo de datos propuesto

Tablas nuevas (con el mismo criterio de las actuales: RLS activado y acceso solo por la función):

- `transferencias`: folio visible (`TRF-00001`), origen (`cierre`, `compra`, `consignacion` o `externa`), `vehiculo_id`, patente, tipo (compra, venta, consignación), precio de la transacción, local, responsable, estado, fechas por etapa, motivo de rechazo o anulación.
- `transferencia_partes`: rol (vendedor, comprador, representante legal), nombre, RUT, nacionalidad, estado civil, domicilio, correo, teléfono, estado de verificación de identidad y de firma.
- `transferencia_docs`: documentos por transferencia (contrato, cédulas, CAV, solicitud de transferencia, comprobantes de pago), con estado y archivos, siguiendo el esquema de `validacion_docs`.
- `transferencia_pagos`: impuesto, arancel, honorario y comprobante; quién pagó y cuándo.
- `transferencia_eventos`: bitácora de cada cambio de estado, con quién y cuándo, y lo que ve el cliente en el seguimiento.

**Estados propuestos:** `borrador` → `datos_completos` → `contrato_generado` → `firmas_pendientes` → `revision_automotora` → `pago_pendiente` → `en_notaria` → `en_registro_civil` → `completada`; además `rechazada` y `anulada`. Un vehículo no puede tener dos transferencias abiertas, igual que hoy con los cierres.

## 7. Requisitos funcionales (borrador priorizado)

**Fase 1: gestor interno (sin firma digital)**
1. Crear una transferencia desde un cierre de venta aprobado, una compra, una consignación o a mano por patente.
2. Cargar y validar datos de las partes (RUT, domicilio, estado civil) y revisar que el vehículo no tenga prohibiciones ni deudas.
3. Generar el contrato de compraventa en PDF con los datos de la automotora, las partes y el vehículo.
4. Lista de documentos requeridos y revisión por el Validador.
5. Calculadora de costos: impuesto (1,5% del valor, según fuentes públicas por confirmar), arancel y honorario.
6. Seguimiento por estados, con avisos por correo al comprador, al vendedor y al ejecutivo.
7. Permisos: quién crea, quién aprueba y quién ve costos.
8. Consulta pública del estado por patente + correo.

**Fase 2: firma e identidad**
9. Portal para que cada parte complete sus datos y firme desde el celular.
10. Verificación de identidad (Clave Única y/o biometría).
11. Firma del representante legal de la automotora.

**Fase 3: tramitación**
12. Pago de impuestos y aranceles, e integración con notaría y Registro Civil (o con Autofact).
13. Adjuntar automáticamente el CAV nuevo y la solicitud de transferencia.

## 8. Reglas de negocio y validaciones a incorporar

- **Pensión de alimentos:** se rechaza la transferencia si una parte es deudora (Ley 21.389).
- **Extranjeros:** cédula vigente o comprobante digital de permanencia vigente.
- **Prohibición de enajenar o prenda** sobre el vehículo: el Registro Civil rechaza la inscripción; hay que revisarlo antes.
- **Permiso de circulación al día**, certificado de inscripción y cédulas vigentes de ambas partes.
- **Contratos a nombre de la automotora:** firma del representante legal.
- **Un solo trámite abierto por vehículo.**
- **Montos y plazos oficiales** (impuesto 1,5%, aranceles del Registro Civil y notaría): las fuentes públicas no coinciden entre sí en los montos fijos. Hay que confirmarlos en registrocivil.cl, el SII y la notaría antes de programarlos.

## 9. Riesgos

- **Legal:** el contrato y la firma electrónica deben revisarlos un abogado. El borrador de consignación ya está marcado así.
- **Datos personales:** cédulas, firmas y datos biométricos son sensibles. Se necesita política de privacidad, acceso mínimo y cifrado de los archivos.
- **Dependencia de terceros:** plazos y costos de firma, biometría y notaría.
- **Alcance:** Autofact lleva más de tres años y declara más de 1,2 millones de transferencias. Replicar todo es un proyecto grande; por eso se propone por fases.

## 10. Decisiones tomadas y pendientes

**Tomada:** camino **C** (por fases). Como la automotora ya tramita con Autofact Pro, la fase 1 se define como un **gestor interno que sigue y ordena lo que se hace en Autofact**, sin reemplazar su firma ni su tramitación.

**Pendientes (bloquean el diseño de la fase 1):**
1. **Contrato:** ¿el contrato lo sigue generando Autofact (el CRM solo registra el folio `TRF…` y su estado) o el CRM genera además su propio contrato de compraventa en PDF para firmar? Recomendación: que Autofact siga generándolo en la fase 1.
2. **Cómo llega el estado:** Autofact no ofrece (que se haya visto) una API ni un aviso automático. En la fase 1 el estado se actualizaría **a mano** copiándolo desde Autofact. Si existe una API o un correo de avisos por cambio de estado, se podría automatizar. Hay que preguntarle a soporte@autofactpro.com.
3. **Tipos de contrato:** ¿el equipo usa solo contrato abierto (toma y consignación) o también cerrado (venta directa a nombre de la automotora)?
4. **Quién hace qué:** quién crea la transferencia, quién aprueba la toma y la venta, y quién paga el impuesto y el arancel (permisos).
5. **Datos de la empresa** para los documentos propios (razón social, RUT, domicilio, representante legal).

## 11. Plan de trabajo propuesto (camino C)

**Fase 1: gestor interno (sin firma ni tramitación propias)**
1. Tabla `transferencias` con el folio de Autofact (`TRF…`), el tipo de contrato, el vínculo con el cierre de venta, la compra o la consignación y el vehículo, el estado de Autofact (los 38 del glosario, agrupados por etapa) y el estado interno del CRM.
2. Datos del vendedor y del comprador, y del vehículo (chasis, motor, kilometraje, permiso de circulación, tasación fiscal del SII).
3. Lista de documentos por transferencia: contrato, CAV, certificado de multas, permiso de circulación, cédulas, mandatos y formulario V6, con archivos, vencimiento y revisión del Validador.
4. Costos: base, arancel estatal e impuesto del 1,5% sobre el mayor valor entre el precio y la tasación fiscal, con quién pagó y cuándo.
5. Declaraciones PEP y de origen de fondos (sobre 10.000 USD), con listado descargable para la UAF.
6. Bitácora de actividad y avisos por correo al ejecutivo y al cliente en los cambios de estado.
7. Alertas: rechazos del Registro Civil o del notario, restricciones, permisos vencidos y transferencias detenidas.
8. Consulta pública del estado por patente y correo (como el sitio de inspecciones).

**Fase 2: contrato propio y firma** (solo si se decide): generación del contrato en PDF y firma electrónica avanzada con un proveedor acreditado, con la nueva verificación de identidad vigente desde el 1 de noviembre de 2026.

**Fase 3: integración o tramitación propia** (solo si se decide): API o convenio con Autofact, o con notaría y Registro Civil.

## 12. Lo que falta ver del sistema de referencia

Se puede completar con la sesión iniciada, siempre en solo lectura:
- Los pasos 2 a 4 del asistente `completar` (avanzar exige guardar, así que conviene hacerlo con un contrato de prueba que el usuario cree).
- El flujo «Agregar comprador» y la pantalla de firma del cliente.
- El detalle del pago y de la factura.
- Las preguntas frecuentes y el manual de la verificación de identidad.
- Una consulta a soporte sobre API o avisos automáticos de estado.
