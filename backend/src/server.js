import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { PGlite } from '@electric-sql/pglite';
import YAML from 'yaml';
import { parseFile } from 'music-metadata';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const resolveFromApp = (value) => path.resolve(appRoot, value);
const dbPath = resolveFromApp(process.env.DATABASE_PATH ?? './data/audio2score');
const uploadDir = resolveFromApp(process.env.UPLOAD_DIR ?? './data/uploads');
const schemaPath = resolveFromApp(process.env.SCHEMA_FILE ?? '../esquema_bd.sql');
const openApiPath = resolveFromApp(process.env.OPENAPI_FILE ?? '../openapi_equipo.yaml');
const ownerId = process.env.DEMO_OWNER_ID ?? '00000000-0000-4000-8000-000000000001';
const ownerEmail = process.env.DEMO_OWNER_EMAIL ?? 'dev@audio2score.local';
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 104857600);
const port = Number(process.env.PORT ?? 3000);
await fs.mkdir(path.dirname(dbPath), { recursive: true });
await fs.mkdir(uploadDir, { recursive: true });

const expectedTableNames = [
  'audio_files', 'exports', 'low_confidence_segments', 'musical_notes',
  'outbox_messages', 'processing_attempts', 'projects', 'revoked_tokens',
  'storage_deletions', 'transcription_summaries',
  'transcription_summary_estimated_fields', 'transcriptions', 'users',
];

const successResponses = new Map();
const registeredOperations = new Set();
const normalizePath = (routePath) => routePath.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
const operationKey = (method, routePath) => `${method.toUpperCase()} ${normalizePath(routePath)}`;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const fail = (status, code, message, details) => {
  throw new HttpError(status, code, message, details);
};

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const db = new PGlite(dbPath);

async function query(sql, params = [], executor = db) {
  return executor.query(sql, params);
}

async function one(sql, params = [], executor = db) {
  const result = await query(sql, params, executor);
  return result.rows[0] ?? null;
}

async function initializeDatabase() {
  const count = await one(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  if (count.count === 0) {
    const schema = await fs.readFile(schemaPath, 'utf8');
    await db.exec(schema);
  }

  const rows = await query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const actual = rows.rows.map((row) => row.table_name);
  const missing = expectedTableNames.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expectedTableNames.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`El esquema no coincide con esquema_bd.sql. Faltantes: ${missing.join(', ') || 'ninguna'}. Extras: ${extra.join(', ') || 'ninguna'}.`);
  }

  await query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, 'dev-only-account')
     ON CONFLICT (id) DO NOTHING`,
    [ownerId, ownerEmail],
  );
  await one('SELECT 1 AS connected');
  return actual.length;
}

function register(method, routePath, successStatus, ...handlers) {
  app[method](routePath, ...handlers);
  registeredOperations.add(operationKey(method, routePath));
  successResponses.set(operationKey(method, routePath), String(successStatus));
}

function verifyOpenApiContract() {
  const spec = YAML.parse(requireText(openApiPath));
  const declared = new Set();
  for (const [routePath, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const key = operationKey(method, routePath);
      declared.add(key);
      const implementedStatus = successResponses.get(key);
      if (!registeredOperations.has(key)) {
        throw new Error(`Falta implementar ${key} del OpenAPI.`);
      }
      if (!operation.responses?.[implementedStatus]) {
        throw new Error(`${key} responde ${implementedStatus}, pero ese código no existe en el OpenAPI.`);
      }
    }
  }
  const extra = [...registeredOperations].filter((key) => !declared.has(key));
  if (extra.length) throw new Error(`Hay operaciones no declaradas en OpenAPI: ${extra.join(', ')}`);
  return declared.size;
}

function requireText(filePath) {
  // The contract is read only during local startup validation.
  return globalThis.__openApiText;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const diskStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const audioUpload = multer({ storage: diskStorage, limits: { fileSize: maxUploadBytes, files: 1 } });

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''))) {
    fail(400, 'INVALID_ID', `${label} debe ser un UUID válido.`);
  }
}

function validateProjectBody(body, isUpdate = false) {
  const details = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'INVALID_BODY', 'El cuerpo JSON debe ser un objeto.');
  }
  if (isUpdate && Object.keys(body).length === 0) details.push({ field: 'body', message: 'Debe incluir al menos un campo.' });
  if ('name' in body && (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120)) {
    details.push({ field: 'name', message: 'El nombre debe contener entre 1 y 120 caracteres.' });
  }
  if (!isUpdate && !('name' in body)) details.push({ field: 'name', message: 'El nombre es obligatorio.' });
  if ('description' in body && body.description !== null && (typeof body.description !== 'string' || body.description.length > 1000)) {
    details.push({ field: 'description', message: 'La descripción debe tener hasta 1000 caracteres o ser null.' });
  }
  if ('archived' in body && typeof body.archived !== 'boolean') {
    details.push({ field: 'archived', message: 'archived debe ser booleano.' });
  }
  if (details.length) fail(422, 'VALIDATION_ERROR', 'Hay campos inválidos.', details);
}

function mapProject(row) {
  return {
    id: row.id, ownerId: row.owner_id, name: row.name, description: row.description,
    status: row.status, audioFileId: row.audio_file_id,
    currentTranscriptionId: row.current_transcription_id,
    failureReason: row.failure_reason, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAudio(row) {
  return {
    id: row.id, projectId: row.project_id, originalFilename: row.original_filename,
    format: row.format, sizeBytes: Number(row.size_bytes), durationSeconds: row.duration_seconds,
    status: row.status, rejectionReason: row.rejection_reason, uploadedAt: row.uploaded_at,
  };
}

function mapAttempt(row) {
  return {
    id: row.id, projectId: row.project_id, status: row.status,
    transcriptionId: row.transcription_id, errorMessage: row.error_message,
    attemptNumber: row.attempt_number, startedAt: row.started_at,
    finishedAt: row.finished_at, configuration: row.configuration,
  };
}

function mapExport(row) {
  return {
    id: row.id, projectId: row.project_id, transcriptionId: row.transcription_id,
    format: row.format, status: row.status, createdAt: row.created_at,
    downloadUrl: row.status === 'listo' ? `/projects/${row.project_id}/exports/${row.id}/file` : null,
    fileName: row.file_name, draftNotice: row.draft_notice,
  };
}

async function readProject(projectId, executor = db) {
  assertUuid(projectId, 'projectId');
  const row = await one('SELECT * FROM projects WHERE id = $1', [projectId], executor);
  if (!row) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  return row;
}

async function enqueue(executor, aggregateType, aggregateId, eventType, payload) {
  await query(
    `INSERT INTO outbox_messages (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)], executor,
  );
}

async function readTranscription(transcriptionId, executor = db) {
  const row = await one('SELECT * FROM transcriptions WHERE id = $1', [transcriptionId], executor);
  if (!row) return null;
  const notes = await query(
    `SELECT pitch, start_time_seconds AS "startTimeSeconds", duration_seconds AS "durationSeconds",
            confidence, is_estimated AS "isEstimated", is_low_confidence AS "isLowConfidence"
     FROM musical_notes WHERE transcription_id = $1 ORDER BY note_index`,
    [transcriptionId], executor,
  );
  const summaryRow = await one('SELECT * FROM transcription_summaries WHERE transcription_id = $1', [transcriptionId], executor);
  let summary = null;
  if (summaryRow) {
    const fields = await query(
      'SELECT field_name FROM transcription_summary_estimated_fields WHERE transcription_id = $1 ORDER BY field_name',
      [transcriptionId], executor,
    );
    summary = {
      notesCount: summaryRow.notes_count,
      coverageEstimatedPercent: summaryRow.coverage_estimated_percent,
      tempoEstimated: row.tempo_estimated,
      keyEstimated: row.key_estimated,
      estimatedFields: fields.rows.map((field) => field.field_name),
    };
  }
  const segments = await query(
    `SELECT note_index AS "noteIndex", reason FROM low_confidence_segments
     WHERE transcription_id = $1 ORDER BY note_index`,
    [transcriptionId], executor,
  );
  const audio = await one("SELECT id FROM audio_files WHERE project_id=$1 AND status='aceptado'", [row.project_id], executor);
  return {
    id: row.id, projectId: row.project_id, processingAttemptId: row.processing_attempt_id,
    version: row.version, notes: notes.rows, tempoEstimated: row.tempo_estimated,
    keyEstimated: row.key_estimated, isDraft: row.is_draft, createdAt: row.created_at,
    updatedAt: row.updated_at,
    audioFileUrl: audio ? `/projects/${row.project_id}/audio-files/${audio.id}` : null,
    summary, lowConfidenceSegments: segments.rows,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

register('post', '/auth/register', 201, asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(422, 'VALIDATION_ERROR', 'El correo no tiene un formato válido.', [{ field: 'email', message: 'Debe ser un correo válido de hasta 254 caracteres.' }]);
  }
  if (typeof password !== 'string' || password.length < 15 || password.length > 128) {
    fail(422, 'VALIDATION_ERROR', 'La contraseña no cumple la longitud requerida.', [{ field: 'password', message: 'Debe tener entre 15 y 128 caracteres.' }]);
  }
  const user = await one(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     RETURNING id, email, created_at`, [email, hashPassword(password)],
  ).catch((error) => {
    if (error.code === '23505') fail(409, 'EMAIL_ALREADY_REGISTERED', 'El correo ya está registrado.');
    throw error;
  });
  res.status(201).json({ id: user.id, email: user.email, createdAt: user.created_at });
}));

register('post', '/auth/login', 200, asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') fail(400, 'INVALID_BODY', 'email y password son obligatorios.');
  const user = await one('SELECT id, email, password_hash, created_at FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user || !passwordMatches(password, user.password_hash)) fail(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
  // Token opaco solo para satisfacer la forma de respuesta local. No se valida en ninguna ruta.
  res.json({ accessToken: crypto.randomBytes(24).toString('base64url'), tokenType: 'Bearer', expiresIn: 3600,
    user: { id: user.id, email: user.email, createdAt: user.created_at } });
}));

register('post', '/auth/logout', 204, (_req, res) => res.status(204).end());
register('get', '/auth/me', 200, asyncHandler(async (_req, res) => {
  const user = await one('SELECT id, email, created_at FROM users WHERE id = $1', [ownerId]);
  if (!user) fail(404, 'USER_NOT_FOUND', 'No se encontró el usuario de desarrollo.');
  res.json({ id: user.id, email: user.email, createdAt: user.created_at });
}));

register('get', '/projects', 200, asyncHandler(async (req, res) => {
  const includeArchived = String(req.query.includeArchived ?? 'false') === 'true';
  const rows = await query(
    `SELECT * FROM projects WHERE ($1::boolean OR archived_at IS NULL)
     ORDER BY created_at DESC`, [includeArchived],
  );
  res.json({ items: rows.rows.map(mapProject) });
}));

register('post', '/projects', 201, asyncHandler(async (req, res) => {
  validateProjectBody(req.body);
  const row = await one(
    `INSERT INTO projects (owner_id, name, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [ownerId, req.body.name.trim(), req.body.description ?? null],
  );
  res.status(201).json(mapProject(row));
}));

register('get', '/projects/:projectId', 200, asyncHandler(async (req, res) => {
  res.json(mapProject(await readProject(req.params.projectId)));
}));

register('patch', '/projects/:projectId', 200, asyncHandler(async (req, res) => {
  validateProjectBody(req.body, true);
  const current = await readProject(req.params.projectId);
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if ('name' in req.body) add('name', req.body.name.trim());
  if ('description' in req.body) add('description', req.body.description);
  if ('archived' in req.body) add('archived_at', req.body.archived ? new Date().toISOString() : null);
  values.push(current.id);
  const row = await one(`UPDATE projects SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  res.json(mapProject(row));
}));

register('delete', '/projects/:projectId', 204, asyncHandler(async (req, res) => {
  assertUuid(req.params.projectId, 'projectId');
  const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [req.params.projectId]);
  if (!result.rows.length) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  res.status(204).end();
}));

register('post', '/projects/:projectId/audio-files', 202, audioUpload.single('file'), asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  if (!req.file) fail(400, 'FILE_REQUIRED', 'Debe adjuntar el archivo en el campo file.');
  const tempPath = req.file.path;
  try {
    const originalFilename = path.basename(req.file.originalname);
    const format = path.extname(originalFilename).toLowerCase() === '.wav' ? 'WAV'
      : path.extname(originalFilename).toLowerCase() === '.mp3' ? 'MP3' : null;
    if (!format) fail(415, 'UNSUPPORTED_AUDIO_FORMAT', 'Solo se aceptan archivos MP3 o WAV.');
    const header = Buffer.alloc(12);
    const fh = await fs.open(tempPath, 'r');
    const { bytesRead } = await fh.read(header, 0, header.length, 0);
    await fh.close();
    const validWav = format === 'WAV' && bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
    const validMp3 = format === 'MP3' && bytesRead >= 3 && (header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0));
    if (!validWav && !validMp3) fail(422, 'INVALID_AUDIO_CONTENT', 'El contenido no corresponde a un archivo de audio válido.');
    let durationSeconds;
    try {
      const metadata = await parseFile(tempPath, { duration: true, skipCovers: true });
      durationSeconds = metadata.format.duration;
    } catch {
      fail(422, 'INVALID_AUDIO_CONTENT', 'No fue posible decodificar el audio.');
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) fail(422, 'INVALID_AUDIO_CONTENT', 'No se pudo determinar la duración del audio.');
    if (durationSeconds > 900) fail(422, 'AUDIO_TOO_LONG', 'El audio excede el límite de 15 minutos.');

    const storageKey = path.relative(uploadDir, tempPath).replaceAll(path.sep, '/');
    const audioId = crypto.randomUUID();
    const result = await db.transaction(async (tx) => {
      const existing = await one('SELECT * FROM audio_files WHERE project_id = $1', [project.id], tx);
      if (existing?.status === 'aceptado') fail(409, 'AUDIO_ALREADY_EXISTS', 'El proyecto ya tiene un audio aceptado.');
      const active = await one("SELECT id FROM processing_attempts WHERE project_id = $1 AND status IN ('pendiente','procesando')", [project.id], tx);
      if (active) fail(409, 'PROCESSING_IN_PROGRESS', 'El proyecto ya tiene un procesamiento activo.');
      let audio;
      if (existing) {
        audio = await one(
          `UPDATE audio_files SET id=$1, original_filename=$2, format=$3, size_bytes=$4,
             duration_seconds=$7, status='aceptado', rejection_reason=NULL,
             uploaded_at=now(), storage_key=$5 WHERE id=$6 RETURNING *`,
          [audioId, originalFilename, format, req.file.size, storageKey, existing.id, durationSeconds], tx,
        );
      } else {
        audio = await one(
          `INSERT INTO audio_files (id, project_id, original_filename, format, size_bytes,
             duration_seconds, status, storage_key)
           VALUES ($1,$2,$3,$4,$5,$6,'aceptado',$7) RETURNING *`,
          [audioId, project.id, originalFilename, format, req.file.size, durationSeconds, storageKey], tx,
        );
      }
      await query("UPDATE projects SET audio_file_id=$1, status='pendiente', failure_reason=NULL WHERE id=$2", [audioId, project.id], tx);
      const previous = await one('SELECT max(attempt_number)::int AS n FROM processing_attempts WHERE project_id=$1', [project.id], tx);
      const attempt = await one(
        `INSERT INTO processing_attempts (project_id, status, attempt_number, configuration)
         VALUES ($1,'pendiente',$2,'{}'::jsonb) RETURNING *`,
        [project.id, (previous?.n ?? 0) + 1], tx,
      );
      await enqueue(tx, 'processing_attempt', attempt.id, 'audio.uploaded', { projectId: project.id, audioFileId: audioId, attemptId: attempt.id });
      return { audio, attempt };
    });
    res.status(202).json({ audioFile: mapAudio(result.audio), projectStatus: 'pendiente', processingStarted: true, requiredConfiguration: [], attempt: mapAttempt(result.attempt) });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}));

register('get', '/projects/:projectId/audio-files/:audioFileId', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  assertUuid(req.params.audioFileId, 'audioFileId');
  const audio = await one('SELECT * FROM audio_files WHERE id=$1 AND project_id=$2', [req.params.audioFileId, project.id]);
  if (!audio) fail(404, 'AUDIO_NOT_FOUND', 'No se encontró el audio.');
  res.json(mapAudio(audio));
}));

register('put', '/projects/:projectId/processing-configurations/current', 202, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail(400, 'INVALID_BODY', 'La configuración debe ser un objeto JSON.');
  if (!project.audio_file_id) fail(409, 'AUDIO_REQUIRED', 'Debe cargar audio antes de configurar el procesamiento.');
  const attempt = await db.transaction(async (tx) => {
    const active = await one("SELECT id FROM processing_attempts WHERE project_id=$1 AND status IN ('pendiente','procesando')", [project.id], tx);
    if (active) fail(409, 'PROCESSING_IN_PROGRESS', 'Ya existe un procesamiento activo.');
    const n = await one('SELECT max(attempt_number)::int AS n FROM processing_attempts WHERE project_id=$1', [project.id], tx);
    const created = await one(
      `INSERT INTO processing_attempts (project_id,status,attempt_number,configuration)
       VALUES ($1,'pendiente',$2,$3::jsonb) RETURNING *`,
      [project.id, (n?.n ?? 0) + 1, JSON.stringify(req.body)], tx,
    );
    await query("UPDATE projects SET status='pendiente', failure_reason=NULL WHERE id=$1", [project.id], tx);
    await enqueue(tx, 'processing_attempt', created.id, 'processing.configured', { projectId: project.id, attemptId: created.id });
    return created;
  });
  res.status(202).json(mapAttempt(attempt));
}));

register('get', '/projects/:projectId/processing-attempts', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  const rows = await query('SELECT * FROM processing_attempts WHERE project_id=$1 ORDER BY attempt_number DESC', [project.id]);
  res.json({ items: rows.rows.map(mapAttempt) });
}));

register('get', '/projects/:projectId/processing-attempts/:attemptId', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  assertUuid(req.params.attemptId, 'attemptId');
  const attempt = await one('SELECT * FROM processing_attempts WHERE id=$1 AND project_id=$2', [req.params.attemptId, project.id]);
  if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'No se encontró el intento de procesamiento.');
  res.json(mapAttempt(attempt));
}));

register('post', '/projects/:projectId/processing-attempts/:attemptId/retry', 202, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  assertUuid(req.params.attemptId, 'attemptId');
  const attempt = await one('SELECT * FROM processing_attempts WHERE id=$1 AND project_id=$2', [req.params.attemptId, project.id]);
  if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'No se encontró el intento de procesamiento.');
  if (attempt.status !== 'fallido') fail(409, 'RETRY_NOT_ALLOWED', 'Solo se puede reintentar un procesamiento fallido.');
  const config = req.body?.configuration ?? attempt.configuration ?? {};
  const next = await db.transaction(async (tx) => {
    const maxN = await one('SELECT max(attempt_number)::int AS n FROM processing_attempts WHERE project_id=$1', [project.id], tx);
    const created = await one(
      `INSERT INTO processing_attempts (project_id,status,attempt_number,configuration)
       VALUES ($1,'pendiente',$2,$3::jsonb) RETURNING *`,
      [project.id, (maxN?.n ?? 0) + 1, JSON.stringify(config)], tx,
    );
    await query("UPDATE projects SET status='pendiente', failure_reason=NULL WHERE id=$1", [project.id], tx);
    await enqueue(tx, 'processing_attempt', created.id, 'processing.retry_requested', { projectId: project.id, attemptId: created.id });
    return created;
  });
  res.status(202).json(mapAttempt(next));
}));

register('get', '/projects/:projectId/transcriptions/current', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  if (!project.current_transcription_id) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'El proyecto aún no tiene transcripción.');
  const transcription = await readTranscription(project.current_transcription_id);
  res.set('ETag', `"v${transcription.version}"`).json(transcription);
}));

register('post', '/projects/:projectId/transcriptions/current/revisions', 201, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  if (!Array.isArray(req.body?.notes)) fail(422, 'VALIDATION_ERROR', 'notes debe ser una lista.', [{ field: 'notes', message: 'Debe ser un arreglo.' }]);
  if (!project.audio_file_id) fail(409, 'AUDIO_REQUIRED', 'Debe cargar audio antes de guardar una transcripción.');
  const current = project.current_transcription_id ? await readTranscription(project.current_transcription_id) : null;
  const ifMatch = req.get('If-Match');
  if (!ifMatch) fail(400, 'IF_MATCH_REQUIRED', 'Debe enviar el encabezado If-Match.');
  if (current && ifMatch !== `"v${current.version}"`) fail(412, 'VERSION_CONFLICT', 'La transcripción cambió; vuelve a cargar la versión vigente.');
  if (!current && ifMatch !== '*') fail(412, 'VERSION_CONFLICT', 'Para crear la primera versión, envía If-Match: *.');
  const invalidNote = req.body.notes.find((note) => !note || typeof note.pitch !== 'string' || !/^[A-G](##?|bb?)?(-1|[0-9])$/.test(note.pitch)
    || !Number.isFinite(note.startTimeSeconds) || note.startTimeSeconds < 0
    || !Number.isFinite(note.durationSeconds) || note.durationSeconds <= 0
    || typeof note.isEstimated !== 'boolean' || typeof note.isLowConfidence !== 'boolean'
    || (note.confidence !== undefined && note.confidence !== null && (!Number.isFinite(note.confidence) || note.confidence < 0 || note.confidence > 1)));
  if (invalidNote) fail(422, 'VALIDATION_ERROR', 'Una o más notas tienen datos inválidos.', [{ field: 'notes', message: 'Revisa pitch, startTimeSeconds y durationSeconds.' }]);

  const saved = await db.transaction(async (tx) => {
    const version = (current?.version ?? 0) + 1;
    const transcription = await one(
      `INSERT INTO transcriptions (project_id,version,is_draft,tempo_estimated,key_estimated)
       VALUES ($1,$2,true,$3,$4) RETURNING *`,
      [project.id, version, req.body.tempoEstimated ?? null, req.body.keyEstimated ?? null], tx,
    );
    for (const [index, note] of req.body.notes.entries()) {
      await query(
        `INSERT INTO musical_notes (transcription_id,note_index,pitch,start_time_seconds,duration_seconds,
           confidence,is_estimated,is_low_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [transcription.id, index, note.pitch, note.startTimeSeconds, note.durationSeconds,
          note.confidence ?? null, Boolean(note.isEstimated), Boolean(note.isLowConfidence)], tx,
      );
    }
    await query('INSERT INTO transcription_summaries (transcription_id,notes_count) VALUES ($1,$2)', [transcription.id, req.body.notes.length], tx);
    await query("UPDATE projects SET current_transcription_id=$1,status='completado',failure_reason=NULL WHERE id=$2", [transcription.id, project.id], tx);
    return transcription.id;
  });
  const response = await readTranscription(saved);
  res.status(201).set('ETag', `"v${response.version}"`).json(response);
}));

register('get', '/projects/:projectId/transcriptions/versions', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  const rows = await query('SELECT id FROM transcriptions WHERE project_id=$1 ORDER BY version DESC', [project.id]);
  const items = [];
  for (const row of rows.rows) items.push(await readTranscription(row.id));
  res.json({ items });
}));

register('post', '/projects/:projectId/exports', 201, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  const format = req.body?.format;
  if (!['midi', 'pdf'].includes(format)) fail(422, 'VALIDATION_ERROR', 'format debe ser midi o pdf.', [{ field: 'format', message: 'Valores permitidos: midi, pdf.' }]);
  if (!project.current_transcription_id) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'El proyecto no tiene transcripción vigente.');
  const idem = req.get('Idempotency-Key') ?? null;
  if (idem && (idem.length < 16 || idem.length > 255)) fail(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key debe tener entre 16 y 255 caracteres.');
  if (idem) {
    const existing = await one('SELECT * FROM exports WHERE project_id=$1 AND idempotency_key=$2', [project.id, idem]);
    if (existing) return res.status(201).json(mapExport(existing));
  }
  const row = await db.transaction(async (tx) => {
    const created = await one(
      `INSERT INTO exports (project_id,transcription_id,format,status,file_name,draft_notice,idempotency_key)
       VALUES ($1,$2,$3,'pendiente',$4,$5,$6) RETURNING *`,
      [project.id, project.current_transcription_id, format,
        `${project.name}.${format}`, null, idem], tx,
    );
    await enqueue(tx, 'export', created.id, 'export.requested', { projectId: project.id, exportId: created.id, format });
    return created;
  });
  res.status(201).json(mapExport(row));
}));

register('get', '/projects/:projectId/exports', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  const rows = await query('SELECT * FROM exports WHERE project_id=$1 ORDER BY created_at DESC', [project.id]);
  res.json({ items: rows.rows.map(mapExport) });
}));

register('get', '/projects/:projectId/exports/:exportId/file', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId);
  assertUuid(req.params.exportId, 'exportId');
  const item = await one('SELECT * FROM exports WHERE id=$1 AND project_id=$2', [req.params.exportId, project.id]);
  if (!item) fail(404, 'EXPORT_NOT_FOUND', 'No se encontró la exportación.');
  if (item.status !== 'listo' || !item.download_key) fail(409, 'EXPORT_NOT_READY', 'La exportación todavía no está disponible.');
  const filePath = path.resolve(uploadDir, item.download_key);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) fail(404, 'EXPORT_NOT_FOUND', 'No se encontró el archivo.');
  await fs.access(filePath).catch(() => fail(404, 'EXPORT_NOT_FOUND', 'No se encontró el archivo.'));
  res.download(filePath, item.file_name ?? path.basename(filePath));
}));

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido.' });
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'El archivo excede 100 MiB.' });
  }
  if (error instanceof HttpError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return res.status(error.status).json(body);
  }
  if (error?.code === '23505') return res.status(409).json({ code: 'CONFLICT', message: 'El registro ya existe.' });
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return res.status(422).json({ code: 'DATA_CONSTRAINT_VIOLATION', message: 'Los datos no cumplen las reglas del esquema.' });
  }
  console.error(error);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno.' });
});

async function main() {
  globalThis.__openApiText = await fs.readFile(openApiPath, 'utf8');
  const routeCount = verifyOpenApiContract();
  const tableCount = await initializeDatabase();
  app.listen(port, () => {
    console.log(`Audio2Score CRUD API escuchando en http://localhost:${port}`);
    console.log(`PostgreSQL conectado; ${tableCount} tablas verificadas; ${routeCount} operaciones OpenAPI registradas.`);
    console.log('Modo local sin JWT ni middleware de autenticación/autorización.');
  });
}

main().catch(async (error) => {
  console.error('No fue posible iniciar la API:', error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
