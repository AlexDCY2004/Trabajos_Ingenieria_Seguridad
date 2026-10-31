# Portal de Citas, Cobertura y Pagos

Implementación del informe *Evaluacion_Unidad_1* (Ingeniería en Seguridad de Software, ESPE): requisitos
S01 a S14, riesgos R01 a R17 y plan de verificación V01 a V21.

## Ejecutar

```bash
docker compose up -d --build              # tras cualquier cambio de código, reconstruir
docker exec citas_backend npm run seed    # datos de prueba
```

| Servicio | URL |
|---|---|
| Aplicación web | http://localhost:5173 |
| API | http://localhost:4000 |
| Correos y SMS de desarrollo (Mailpit) | http://localhost:8025 |

Base existente creada con una versión anterior: aplicar en orden `database/migraciones/001_*.sql`,
`002_*.sql`, `02_security_rls.sql`, `03_triggers_audit.sql` y `05_rol_aplicacion.sql` (todos idempotentes).

## Cuentas de prueba

Contraseña de todas: `Prueba#2026`. El personal enrola una app autenticadora (TOTP) en el primer ingreso.

| Rol | Cuenta | Qué hace |
|---|---|---|
| Paciente | ana.torres@correo.com (Salud Andina), pedro.cedeno@correo.com (Confiamed), diego.paz@correo.com (sin póliza) | Reserva, cobertura, pago, dependientes, derechos |
| Recepción | recepcion@citas.com (Sede Quito Norte) | Agenda de su sede, llegada, cobro en caja, dependientes |
| Médico | medico@citas.com (Cardiología) | Su agenda, atendida o no asistió |
| Aseguradora | aseguradora@citas.com (Salud Andina) | Solicitudes de sus afiliados, autoriza o rechaza |
| Administrador | admin@citas.com | Sedes y profesionales |
| Oficial de seguridad | seguridad@citas.com | Bitácora, alertas, accesos, incidentes, aprobación de break-glass |
| DPD | dpd@citas.com | Bitácora, incidentes (art. 43), solicitudes de derechos, conservación |
| Contabilidad | contabilidad@citas.com | Conciliación de pagos |
| Soporte / DevOps | soporte@citas.com | Estado operativo; acceso de emergencia aprobado por el oficial |

Para ver la autorización previa (Figura 11, UC18): con Ana reserve con el cardiólogo; la cita queda
"Esperando autorización". En otra ventana, con la aseguradora, autorícela o recháchela en *Afiliados*.

## Verificar

```bash
docker exec citas_backend npm run verificar   # V01, V03, V04, V07, V15, V16 contra la base
node pruebas/flujos-seguridad.js              # flujos y controles de punta a punta contra la API
k6 run pruebas/carga.k6.js                    # carga (V08); requiere RATE_LIMIT_POR_MINUTO alto
```

`flujos-seguridad.js` enrola el TOTP del personal: ejecútelo con una base recién sembrada (su cabecera
indica cómo restablecer el segundo factor para repetirlo). El pipeline `.github/workflows/consultas-medicas.yml`
ejecuta todo lo anterior más gitleaks, Semgrep, npm audit, SBOM, Trivy y OWASP ZAP (Figura 12).

## Qué está simulado o fuera del alcance local

Lo siguiente es infraestructura o integración con terceros que el informe especifica pero que no se puede
levantar en un entorno local con Docker. El código deja el punto de integración listo:

- **Aseguradoras (S07)**: respuestas simuladas con reglas fijas. En producción, adaptador REST con TLS 1.3,
  mTLS y OAuth 2.0 con token ligado al certificado.
- **Pasarela de pagos (S11)**: el formulario alojado se simula; el webhook firmado se procesa por el mismo
  camino que el real. `PASARELA_IPS` activa la lista de IP permitidas.
- **SMS**: sin `SMS_API_URL` llega a Mailpit dirigido a `<teléfono>@sms.local`.
- **HCE**: sin `HCE_URL` el envío (solo identificadores de cita y paciente) se registra en el log del backend.
- **CAPTCHA**: desafío aritmético propio; en producción, el del WAF o de un proveedor.
- **OpenID Connect con PKCE (S10)**: la sesión cumple los controles (access token de 15 min en memoria,
  refresh rotativo en cookie HttpOnly con detección de reutilización, nunca tokens en URL) con un servicio de
  identidad propio, no con un proveedor OIDC externo.
- **Arquitectura de la sección 3.2 y S13**: dos zonas, réplica con conmutación, KMS, WAF, CDN, respaldos
  inmutables en otra región, SIEM y la aplicación móvil Flutter no forman parte de este entorno local.
