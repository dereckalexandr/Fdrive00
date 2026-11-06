# Levantamiento: módulo de transferencias digitales de vehículos

Fecha: 6 de noviembre de 2026 · Referencia: Autofact Pro (`autofactpro.com/cl`, flujo `transferencia/completar/TRF…`) y Autofact (`autofact.cl/transferencias`).

## 1. Qué se pudo observar y qué no

**Observado (páginas públicas):**
- `autofactpro.com/cl`: portada de acceso para clientes (inicio de sesión con Microsoft o con cuenta Autofact) y descripción de sus productos: Informe Autofact, Transferencias digitales, Limpieza de multas y Retomas.
- `autofactpro.com/transferencias-digitales-vehiculos`: descripción del flujo para automotoras.
- `autofact.cl/transferencias/automotoras` y `autofact.cl/transferencias?activeTab=trackingTrf`: precio, pasos, antifraude, seguimiento y calculadora de costos.

**No observado:** la pantalla que quedó abierta (`transferencia/completar/TRF687fe25212861`) está detrás del inicio de sesión y solo se ve la portada de acceso. No se inició sesión ni se ingresó ninguna credencial. Por eso **no se vieron** los formularios internos, los campos exactos, los estados ni el panel de la automotora. Esa parte del levantamiento queda pendiente (ver sección 12).

Las preguntas frecuentes de Autofact (qué se necesita para empezar, cuánto demora, cómo se hace el seguimiento) están plegadas y no se pudieron leer.

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
- **C. Híbrida por fases.** Se parte con el gestor interno (A, con generación del contrato y control de documentos y estados) y se agrega la firma electrónica y la identidad cuando haya proveedor. Es la recomendación.

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

## 10. Decisiones que necesito de ti

1. **Camino:** ¿A (delegar en Autofact), B (plataforma propia) o C (por fases)?
2. **Alcance de la fase 1:** ¿qué tipos de transferencia entran primero: ventas, compras, consignaciones, o las tres?
3. **Quién tramita hoy** las transferencias y cómo (notaría, Autofact, un gestor): ¿cuántas por mes?
4. **Cuenta de Autofact:** ¿ya tienen cuenta de empresa? ¿Saben si ofrecen API o integración?
5. **Datos de la empresa** para el contrato: razón social, RUT, domicilio, representante legal y su RUT.
6. **Quién aprueba** el contrato y los pagos (roles y permisos).

## 11. Plan de trabajo propuesto

1. Cerrar este levantamiento con tus respuestas y con las pantallas internas de Autofact.
2. Modelo de datos y estados (`supabase-crm-transferencias.sql`) y reglas puras con pruebas.
3. Pantallas de gestión en el CRM (lista, ficha, documentos, costos).
4. Generación del contrato de compraventa en PDF.
5. Seguimiento público y avisos por correo.
6. Integración de firma e identidad (fase 2) según el proveedor elegido.

## 12. Lo que falta ver del sistema de referencia

Para completar el levantamiento, hace falta ver las pantallas internas. Esto lo tienes que hacer tú, iniciando sesión en tu cuenta (no se ingresa ninguna credencial desde aquí):

- El listado de transferencias de la automotora y sus estados.
- La pantalla `transferencia/completar/TRF…` con todos sus campos, pasos y botones.
- El contrato que se genera, los documentos que piden y cómo se firma.
- Cómo se paga y cuánto cobra por cada concepto.
- El seguimiento que ve el cliente.

Con esas pantallas abiertas en el navegador, se puede leer su estructura y ajustar este documento.
