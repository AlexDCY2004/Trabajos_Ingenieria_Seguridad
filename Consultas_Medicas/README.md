# Portal de Citas Médicas

Portal para reservar citas, verificar cobertura de aseguradora y pagar copagos. Incluye autenticación con segundo factor opcional para pacientes y panel de administración para el catálogo de profesionales.

## Ejecutar

Levanta todos los servicios con Docker:

```bash
docker compose up -d --build
```

Luego siembra los datos de prueba:

```bash
docker exec citas_backend node dist/scripts/seed.js
```

### URLs

| Servicio | URL |
|---|---|
| Aplicación web | http://localhost:5173 |
| API | http://localhost:4000 |
| Mailpit (correos y SMS de desarrollo) | http://localhost:8025 |

Si ya tenías una base creada con una versión anterior, aplica las migraciones en orden: `database/migraciones/001_*.sql`, `002_*.sql`, `02_security_rls.sql`, `03_triggers_audit.sql` y `05_rol_aplicacion.sql` (son idempotentes).

## Cuentas de prueba

Todas las cuentas usan la misma contraseña:

```
Prueba#2026
```

### Personal

| Rol | Correo |
|---|---|
| Administrador | admin@citas.com |
| Oficial de seguridad | seguridad@citas.com |
| DPD | dpd@citas.com |
| Recepción | recepcion@citas.com |
| Aseguradora | aseguradora@citas.com |
| Contabilidad | contabilidad@citas.com |
| Soporte / DevOps | soporte@citas.com |

### Médicos (uno por profesional)

Cada médico tiene su propia cuenta vinculada a su agenda:

| Correo | Nombre | Especialidad |
|---|---|---|
| andrea.villacis.mora@citas.com | Andrea Villacís Mora | Medicina General |
| carlos.andrade.ruiz@citas.com | Carlos Andrade Ruiz | Cardiología |
| gabriela.proano.leon@citas.com | Gabriela Proaño León | Pediatría |
| luis.cevallos.paredes@citas.com | Luis Cevallos Paredes | Dermatología |
| maria.fernanda.zambrano.vera@citas.com | María Fernanda Zambrano Vera | Ginecología |
| jorge.macias.loor@citas.com | Jorge Macías Loor | Medicina General |
| daniela.ordonez.crespo@citas.com | Daniela Ordóñez Crespo | Traumatología |
| santiago.vintimilla.arce@citas.com | Santiago Vintimilla Arce | Oftalmología |
| paola.jaramillo.tapia@citas.com | Paola Jaramillo Tapia | Cardiología |

No hay pacientes creados de antemano. Desde el frontend puedes registrar un paciente nuevo y reservar citas con cualquiera de los médicos.

## Qué hace cada rol

| Rol | Funciones |
|---|---|
| Paciente | Reserva citas con cualquier profesional, verifica cobertura de su aseguradora, paga copagos, registra dependientes, presenta solicitudes de derechos (rectificación, acceso, eliminación, etc.) y descarga sus propios datos. |
| Recepción | Gestiona la agenda de su sede, registra la llegada de los pacientes, cobra en caja (efectivo o datáfono) y verifica la documentación de dependientes. |
| Médico | Ve su propia agenda de citas y las marca como atendida o ausente cuando el paciente se presenta. |
| Aseguradora | Revisa las solicitudes de cobertura de sus afiliados y las autoriza o rechaza antes de que el paciente pueda confirmar la cita. |
| Administrador | Crea y edita sedes y profesionales del catálogo, y los activa o desactiva cuando sea necesario. |
| Oficial de seguridad | Revisa la bitácora de auditoría, registra incidentes de seguridad, revisa accesos del personal y aprueba o rechaza solicitudes de acceso de emergencia del soporte. |
| DPD | Ve las solicitudes de derechos de los pacientes, las atiende o rechaza, registra incidentes que afecten datos personales y aplica la política de conservación de datos. |
| Contabilidad | Concilia los pagos recibidos, distinguiendo si fueron por pasarela en línea o por caja en la sede. |
| Soporte / DevOps | Ve el estado operativo del sistema y puede solicitar acceso de emergencia a la agenda de una sede, el cual debe ser aprobado por el oficial de seguridad. |

## Mecanismos de seguridad implementados

El portal incluye varias capas de protección para cuidar los datos de los pacientes y evitar accesos no autorizados:

**Contra inyección SQL**
- Todas las consultas a la base de datos usan parámetros (`$1`, `$2`, etc.) en lugar de concatenar texto, así que no es posible inyectar SQL a través de los campos de entrada.
- PostgreSQL usa Row Level Security (RLS): cada consulta filtra automáticamente los datos según el rol y el usuario que está autenticado (un paciente solo ve sus propias citas, un médico solo las suyas, etc.).

**Contra ataques de fuerza bruta y DoS**
- Límite de peticiones por IP en endpoints de login, registro, renovación de sesión y reservas.
- Una cuenta se bloquea temporalmente tras varios intentos fallidos de contraseña.
- La prueba de carga usa un límite alto por IP para no bloquear las pruebas automatizadas.

**Contra suplantación de sesión (XSS, robo de token)**
- El access token dura solo 15 minutos y vive en memoria del navegador, no se guarda en localStorage.
- El refresh token está en una cookie HttpOnly que JavaScript no puede leer, evitando que un script malicioso lo robe.
- Cada renovación rota el refresh token; si alguien intenta reutilizar uno viejo, se revoca toda la familia de tokens y se cierra la sesión.
- Headers de seguridad con Helmet: Content Security Policy, HSTS, no-cache, Referrer-Policy no-referrer.

**Protección de contraseñas**
- Las contraseñas se hashean con Argon2, un algoritmo resistente a ataques de fuerza bruta.
- Al registrarse se revisa que la contraseña no aparezca en listas de contraseñas filtradas públicamente.
- Se exige una contraseña con mayúscula, minúscula, número y símbolo.

**Segundo factor (MFA)**
- Los pacientes pueden activar un código de 6 dígitos con una app autenticadora (Google Authenticator, Authy, etc.).
- El secreto TOTP se guarda cifrado en la base de datos, nunca en texto plano.
- Al iniciar sesión con 2FA activado, se pide el código después de la contraseña.

**Cifrado de datos sensibles**
- El número de póliza de los pacientes se guarda cifrado en la base de datos.
- La identificación (cédula/pasaporte) se guarda como huella (HMAC), no se guarda el número en claro.
- El secreto del segundo factor también se guarda cifrado.

**Auditoría**
- Hay una bitácora inmutable (WORM) que registra quién hizo qué, cuándo y con qué resultado. Solo se puede escribir a través de una función segura de la base de datos, no se puede borrar ni modificar.

**Validación de entradas**
- Todos los datos que llegan del frontend se validan con esquemas estrictos (formato de correo, cédula ecuatoriana, teléfono, contraseña, fechas, etc.) antes de procesarlos.

## Autenticación en dos pasos (opcional para pacientes)

Desde **Mi perfil**, un paciente puede activar la autenticación en dos pasos:

1. Entra con tu correo y contraseña.
2. Ve a Mi perfil y busca la sección "Autenticación en dos pasos".
3. Actívala: se mostrará un código QR y una clave secreta. Escanea el QR con Google Authenticator, Authy o cualquier app TOTP.
4. Escribe el código de 6 dígitos para confirmar y activar.

La próxima vez que inicies sesión, después de la contraseña te pedirá el código de tu app autenticadora.

Si ya lo activaste y quieres quitarlo, desde el mismo perfil aparece un formulario para desactivarlo pidiendo el código de la app.

## Administrar doctores (solo admin)

Entra con `admin@citas.com` y ve a Administración del catálogo. Desde ahí puedes:

- Agregar un nuevo doctor: rellena nombres, apellidos, especialidad, sede y (opcional) correo y contraseña. Si no pones correo ni contraseña, se generan automáticamente con el nombre del profesional y `Prueba#2026`.
- Editar un doctor existente: nombres, apellidos, especialidad y sede.
- Activar o desactivar un doctor.
- Borrar un doctor: solo se puede si no tiene citas asociadas. Si tiene citas, desactívalo en lugar de borrarlo.

## Qué está simulado o no disponible en local

Estas integraciones no se pueden levantar completamente con Docker localmente, pero el código tiene el punto de listo:

- **Aseguradoras**: respuestas simuladas con reglas fijas.
- **Pasarela de pagos**: el formulario se simula y el webhook firmado se procesa igual que el real.
- **SMS**: si no defines `SMS_API_URL`, los mensajes llegan a Mailpit dirigido a `<telefono>@sms.local`.
- **HCE**: sin `HCE_URL`, el envío de identificadores de cita y paciente solo se registra en el log del backend.
- **CAPTCHA**: desafío aritmético propio.
- **Sesión**: access token de 15 minutos en memoria, refresh rotativo en cookie HttpOnly con detección de reutilización.

## Pruebas

```bash
# Verificaciones contra la base de datos
docker exec citas_backend node dist/scripts/verificaciones.js

# Flujos de seguridad de punta a punta contra la API
PASSWORD_PRUEBA='Prueba#2026' node pruebas/flujos-seguridad.js

# Prueba de carga
k6 run pruebas/carga.k6.js
```