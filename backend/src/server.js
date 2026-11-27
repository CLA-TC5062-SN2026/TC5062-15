import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { PGlite } from '@electric-sql/pglite';
import YAML from 'yaml';
import { parseFile } from 'music-metadata';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const resolveFromApp = (value) => path.resolve(appRoot, value);
const dbPath = resolveFromApp(process.env.DATABASE_PATH ?? './data/audio2score');
const uploadDir = resolveFromApp(process.env.UPLOAD_DIR ?? './data/uploads');
const schemaPath = resolveFromApp(process.env.SCHEMA_FILE ?? './esquema_bd.sql');
const openApiPath = resolveFromApp(process.env.OPENAPI_FILE ?? './openapi_equipo.yaml');
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 104857600);
const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? '';
const jwtExpirationSeconds = Number(process.env.JWT_EXPIRATION ?? 3600);
const lowConfidenceThreshold = Number(process.env.LOW_CONFIDENCE_THRESHOLD ?? 0.5);
const basicPitchPython = process.env.BASIC_PITCH_PYTHON
  ? path.resolve(appRoot, process.env.BASIC_PITCH_PYTHON)
  : path.join(appRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const basicPitchScript = path.join(here, 'basic_pitch_transcribe.py');
const jwtIssuer = 'audio2score-api';
const jwtAudience = 'audio2score-client';
const scrypt = promisify(crypto.scrypt);
const execFileAsync = promisify(execFile);
const loginFailures = new Map();
const loginFailureLimit = 5;
const loginFailureWindowMs = 15 * 60 * 1000;
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

function errorPayload(code, message, details) {
  const payload = { error: code, code, message };
  if (details !== undefined) payload.details = details;
  return payload;
}

function validateIdempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return null;
  if (key.length < 16 || key.length > 255) {
    fail(422, 'VALIDATION_ERROR', 'Idempotency-Key debe tener entre 16 y 255 caracteres.', [
      { field: 'Idempotency-Key', message: 'Debe contener entre 16 y 255 caracteres.' },
    ]);
  }
  return key;
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const db = new PGlite(dbPath);
const workerTimers = new Set();
let isShuttingDown = false;

async function query(sql, params = [], executor = db) {
  return executor.query(sql, params);
}

async function one(sql, params = [], executor = db) {
  const result = await query(sql, params, executor);
  return result.rows[0] ?? null;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) fail(401, 'UNAUTHORIZED', 'Se requiere un token Bearer válido.');

  let claims;
  try {
    claims = jwt.verify(match[1], jwtSecret, {
      algorithms: ['HS256'],
      audience: jwtAudience,
      issuer: jwtIssuer,
    });
  } catch {
    fail(401, 'UNAUTHORIZED', 'El token no es válido o expiró.');
  }

  if (!claims || typeof claims !== 'object'
    || typeof claims.sub !== 'string'
    || typeof claims.jti !== 'string'
    || !Number.isSafeInteger(claims.exp)) {
    fail(401, 'UNAUTHORIZED', 'El token no es válido o expiró.');
  }

  const revoked = await one(
    'SELECT 1 FROM revoked_tokens WHERE jti = $1 AND expires_at > now()',
    [claims.jti],
  );
  if (revoked) fail(401, 'UNAUTHORIZED', 'La sesión fue cerrada. Inicia sesión nuevamente.');

  req.auth = { userId: claims.sub, tokenId: claims.jti, expiresAt: claims.exp };
  return next();
});

function validateAuthConfiguration() {
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET debe configurarse con al menos 32 caracteres aleatorios.');
  }
  if (!Number.isSafeInteger(jwtExpirationSeconds) || jwtExpirationSeconds <= 0) {
    throw new Error('JWT_EXPIRATION debe ser un entero positivo expresado en segundos.');
  }
}

function createLoginAttemptKey(req, email) {
  const clientAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return `${clientAddress}:${email.toLowerCase()}`;
}

function checkLoginAttemptLimit(req, res, key) {
  const attempt = loginFailures.get(key);
  const now = Date.now();
  if (!attempt) return;
  if (attempt.resetAt <= now) {
    loginFailures.delete(key);
    return;
  }
  if (attempt.blockedUntil > now) {
    res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000))));
    fail(429, 'LOGIN_RATE_LIMITED', 'Demasiados intentos de inicio de sesión. Espera antes de volver a intentarlo.');
  }
}

function recordFailedLogin(key) {
  const now = Date.now();
  const previous = loginFailures.get(key);
  const attempt = previous && previous.resetAt > now
    ? previous
    : { count: 0, resetAt: now + loginFailureWindowMs, blockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= loginFailureLimit) attempt.blockedUntil = attempt.resetAt;
  loginFailures.set(key, attempt);

  if (loginFailures.size > 10000) {
    for (const [attemptKey, value] of loginFailures) {
      if (value.resetAt <= now) loginFailures.delete(attemptKey);
      if (loginFailures.size <= 5000) break;
    }
  }
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

  await one('SELECT 1 AS connected');
  return actual.length;
}

function register(method, routePath, successStatus, ...handlers) {
  app[method](routePath, ...handlers);
  registeredOperations.add(operationKey(method, routePath));
  successResponses.set(operationKey(method, routePath), String(successStatus));
}

function verifyOpenApiContract() {
  const spec = YAML.parse(requireText());
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

function requireText() {
  // The contract is read only during local startup validation.
  return globalThis.__openApiText;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
// The OpenAPI server and frontend use /v1; map it to the existing route handlers.
app.use((req, _res, next) => {
  if (req.url === '/v1' || req.url.startsWith('/v1/')) {
    req.url = req.url.slice(3) || '/';
  }
  next();
});

const diskStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const audioUpload = multer({ storage: diskStorage, limits: { fileSize: maxUploadBytes, files: 1 } });

function assertUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''))) {
    fail(404, 'RESOURCE_NOT_FOUND', `No se encontró el recurso identificado por ${label}.`);
  }
}

function validateProjectBody(body, isUpdate = false) {
  const details = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(422, 'VALIDATION_ERROR', 'El cuerpo JSON debe ser un objeto.', [
      { field: 'body', message: 'Envía un objeto JSON con los campos permitidos.' },
    ]);
  }
  const allowedFields = isUpdate
    ? new Set(['name', 'description', 'archived'])
    : new Set(['name', 'description']);
  for (const field of Object.keys(body)) {
    if (!allowedFields.has(field)) {
      details.push({ field, message: 'El campo no está permitido.' });
    }
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
    format: row.format, sizeBytes: Number(row.size_bytes),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
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

function pitchNameToMidi(pitch) {
  const match = /^([A-G])(##?|bb?)?(-1|[0-9])$/.exec(pitch);
  if (!match) throw new Error(`El tono ${pitch} no se puede representar en MIDI.`);
  const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
  const accidental = match[2] === '#' ? 1 : match[2] === '##' ? 2 : match[2] === 'b' ? -1 : match[2] === 'bb' ? -2 : 0;
  const midiPitch = (Number(match[3]) + 1) * 12 + pitchClass + accidental;
  if (midiPitch < 0 || midiPitch > 127) throw new Error(`El tono ${pitch} queda fuera del rango MIDI.`);
  return midiPitch;
}

function encodeVariableLength(value) {
  let buffer = value & 0x7f;
  while ((value >>= 7)) buffer = (buffer << 8) | ((value & 0x7f) | 0x80);
  const bytes = [];
  while (buffer & 0x80) {
    bytes.push(buffer & 0xff);
    buffer >>= 8;
  }
  bytes.push(buffer);
  return Buffer.from(bytes);
}

function makeMidiFile(transcription) {
  const estimatedTempo = Number(transcription.tempoEstimated);
  const tempoBpm = Number.isFinite(estimatedTempo) && estimatedTempo > 0 ? estimatedTempo : 120;
  const microsecondsPerBeat = Math.round(60_000_000 / tempoBpm);
  const ticksPerSecond = 480 * tempoBpm / 60;
  const events = [];
  for (const note of transcription.notes) {
    const pitch = pitchNameToMidi(note.pitch);
    const startTick = Math.max(0, Math.round(Number(note.startTimeSeconds) * ticksPerSecond));
    const endTick = Math.max(startTick + 1, Math.round((Number(note.startTimeSeconds) + Number(note.durationSeconds)) * ticksPerSecond));
    events.push({ tick: startTick, order: 1, data: [0x90, pitch, 88] });
    events.push({ tick: endTick, order: 0, data: [0x80, pitch, 0] });
  }
  events.sort((left, right) => left.tick - right.tick || left.order - right.order);

  const trackEvents = [
    Buffer.from([0x00, 0xff, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xff, (microsecondsPerBeat >> 8) & 0xff, microsecondsPerBeat & 0xff]),
    Buffer.from([0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]), // 4/4
  ];
  let previousTick = 0;
  for (const event of events) {
    trackEvents.push(encodeVariableLength(event.tick - previousTick));
    trackEvents.push(Buffer.from(event.data));
    previousTick = event.tick;
  }
  trackEvents.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));
  const track = Buffer.concat(trackEvents);
  const header = Buffer.alloc(14);
  header.write('MThd', 0, 'ascii');
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);
  const trackHeader = Buffer.alloc(8);
  trackHeader.write('MTrk', 0, 'ascii');
  trackHeader.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, trackHeader, track]);
}

function makePdfFile(projectName, transcription) {
  const ascii = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
  const escape = (value) => ascii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const notesPerPage = 12;
  const pageCount = Math.max(1, Math.ceil(transcription.notes.length / notesPerPage));
  const generatedAt = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(new Date());
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageId = 4 + pageIndex * 2;
    const streamId = pageId + 1;
    const content = [
      'BT /F1 18 Tf 48 790 Td (Audio2Score - Transcripcion) Tj ET',
      `BT /F1 12 Tf 48 766 Td (${escape(projectName)} - version ${transcription.version}${transcription.isDraft ? ' - borrador' : ''}) Tj ET`,
      `BT /F1 9 Tf 48 750 Td (Generado: ${escape(generatedAt)}) Tj ET`,
      'BT /F1 9 Tf 48 730 Td (No.     Tono       Inicio (s)       Duracion (s)       Revisar) Tj ET',
      '0.75 w 48 723 m 548 723 l S',
    ];
    const pageNotes = transcription.notes.slice(pageIndex * notesPerPage, (pageIndex + 1) * notesPerPage);
    content.push('BT /F1 10 Tf 48 500 Td (Partitura esquematica - clave de sol) Tj ET');
    content.push('BT /F1 8 Tf 48 486 Td (La posicion muestra la altura; el orden conserva la secuencia de notas.) Tj ET');
    for (let line = 0; line < 5; line += 1) {
      const y = 390 - line * 10;
      content.push('0.55 w 78 ' + y + ' m 550 ' + y + ' l S');
    }
    pageNotes.forEach((note, index) => {
      const match = /^([A-G])([#b]?)(-?\d+)$/.exec(note.pitch || '');
      if (!match) return;
      const diatonic = Number(match[3]) * 7 + { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }[match[1]];
      const y = 350 + (diatonic - 30) * 5;
      const x = 92 + index * 38;
      const ledgerSteps = diatonic < 30
        ? Array.from({ length: Math.ceil((30 - diatonic) / 2) }, (_, i) => 30 - (i + 1) * 2)
        : diatonic > 38
          ? Array.from({ length: Math.ceil((diatonic - 38) / 2) }, (_, i) => 38 + (i + 1) * 2)
          : [];
      for (const step of ledgerSteps) {
        const ledgerY = 350 + (step - 30) * 5;
        content.push('0.45 w ' + (x - 7) + ' ' + ledgerY + ' m ' + (x + 7) + ' ' + ledgerY + ' l S');
      }
      if (match[2]) {
        content.push('BT /F1 8 Tf ' + (x - 11) + ' ' + (y - 2) + ' Td (' + (match[2] === '#' ? '#' : 'b') + ') Tj ET');
      }
      if (note.confidence == null || !Number.isFinite(Number(note.confidence))) {
        content.push('0.20 0.31 0.50 rg');
      } else {
        const confidence = Math.max(0, Math.min(1, Number(note.confidence)));
        const red = (168 - 130 * confidence) / 255;
        const green = (39 + 77 * confidence) / 255;
        const blue = (39 + 34 * confidence) / 255;
        content.push(red.toFixed(3) + ' ' + green.toFixed(3) + ' ' + blue.toFixed(3) + ' rg');
      }
      const rx = 5.3;
      const ry = 3.7;
      const k = 0.5522848;
      const ellipse = [
        (x - rx) + ' ' + y + ' m',
        (x - rx) + ' ' + (y + k * ry) + ' ' + (x - k * rx) + ' ' + (y + ry) + ' ' + x + ' ' + (y + ry) + ' c',
        (x + k * rx) + ' ' + (y + ry) + ' ' + (x + rx) + ' ' + (y + k * ry) + ' ' + (x + rx) + ' ' + y + ' c',
        (x + rx) + ' ' + (y - k * ry) + ' ' + (x + k * rx) + ' ' + (y - ry) + ' ' + x + ' ' + (y - ry) + ' c',
        (x - k * rx) + ' ' + (y - ry) + ' ' + (x - rx) + ' ' + (y - k * ry) + ' ' + (x - rx) + ' ' + y + ' c h f',
      ].join(' ');
      content.push(ellipse);
      const stemEnd = y < 370 ? y + 24 : y - 24;
      content.push('0.20 0.31 0.50 RG 0.8 w ' + (x + 4) + ' ' + y + ' m ' + (x + 4) + ' ' + stemEnd + ' l S');
    });
    content.push('BT /F1 9 Tf 48 175 Td (Color: rojo = confianza estimada baja; verde = confianza estimada alta.) Tj ET');
    content.push('BT /F1 8 Tf 48 161 Td (La confianza no es una probabilidad calibrada; las notas marcadas requieren revision.) Tj ET');
    pageNotes.forEach((note, index) => {
      const noteNumber = pageIndex * notesPerPage + index + 1;
      const review = note.isLowConfidence ? 'si' : 'no';
      const row = `${String(noteNumber).padStart(3, '0')}     ${note.pitch}          ${Number(note.startTimeSeconds).toFixed(3)}              ${Number(note.durationSeconds).toFixed(3)}             ${review}`;
      content.push(`BT /F1 9 Tf 48 ${705 - index * 14} Td (${escape(row)}) Tj ET`);
    });
    content.push(`BT /F1 8 Tf 48 35 Td (Version ${transcription.version} - pagina ${pageIndex + 1} de ${pageCount}) Tj ET`);
    const stream = content.join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
  }

  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'ascii');
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, 'ascii');
}

function safeExportBaseName(value) {
  return String(value || 'Audio2Score')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_ .-]+|[_ .-]+$/g, '')
    .slice(0, 80) || 'Audio2Score';
}

async function readProject(projectId, userId, executor = db) {
  assertUuid(projectId, 'projectId');
  const row = await one('SELECT * FROM projects WHERE id = $1', [projectId], executor);
  if (!row) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  if (row.owner_id !== userId) fail(403, 'FORBIDDEN', 'No tienes permiso para acceder a este proyecto.');
  return row;
}

async function enqueue(executor, aggregateType, aggregateId, eventType, payload) {
  await query(
    `INSERT INTO outbox_messages (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)], executor,
  );
}

let storageDeletionInProgress = false;

async function processStorageDeletionQueue() {
  if (storageDeletionInProgress) return;
  storageDeletionInProgress = true;
  try {
    const pending = await query(
      'SELECT id, object_key FROM storage_deletions WHERE deleted_at IS NULL ORDER BY requested_at LIMIT 25',
    );
    const uploadRoot = path.resolve(uploadDir);
    for (const item of pending.rows) {
      const filePath = path.resolve(uploadRoot, item.object_key);
      const relativePath = path.relative(uploadRoot, filePath);
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        await query(
          'UPDATE storage_deletions SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
          [item.id, 'La clave de almacenamiento queda fuera del directorio permitido.'],
        );
        continue;
      }

      try {
        await fs.rm(filePath, { force: true });
        await query(
          'UPDATE storage_deletions SET deleted_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1',
          [item.id],
        );
      } catch (error) {
        await query(
          'UPDATE storage_deletions SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
          [item.id, String(error?.message ?? 'No fue posible eliminar el archivo.').slice(0, 1000)],
        );
      }
    }
  } finally {
    storageDeletionInProgress = false;
  }
}

function startStorageDeletionWorker() {
  const processBatch = () => processStorageDeletionQueue().catch((error) => {
    console.error('No fue posible procesar la cola de eliminación de archivos:', error);
  });
  void processBatch();
  const timer = setInterval(processBatch, 5000);
  timer.unref();
  workerTimers.add(timer);
}

let processingQueueInProgress = false;
let exportQueueInProgress = false;

async function runBasicPitch(audioPath) {
  const { stdout } = await execFileAsync(basicPitchPython, [basicPitchScript, audioPath], {
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = JSON.parse(stdout.trim());
  if (!Array.isArray(output.notes)) throw new Error('La respuesta del motor no contiene notas.');
  return output.notes;
}

function midiPitchName(midiPitch) {
  const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return pitchClasses[midiPitch % 12] + (Math.floor(midiPitch / 12) - 1);
}

async function finishProcessingFailure(message, publicMessage, error) {
  const errorText = String(error?.message ?? publicMessage).slice(0, 1000);
  console.error('Falló el procesamiento ' + message.aggregate_id + ':', errorText);
  await db.transaction(async (tx) => {
    const attempt = await one('SELECT project_id FROM processing_attempts WHERE id=$1', [message.aggregate_id], tx);
    if (attempt) {
      await query(
        'UPDATE processing_attempts SET status=$2, error_message=$3, finished_at=now(), heartbeat_at=now(), lease_expires_at=NULL WHERE id=$1 AND status=$4',
        [message.aggregate_id, 'fallido', publicMessage, 'procesando'], tx,
      );
      await query(
        'UPDATE projects SET status=$2, failure_reason=$3 WHERE id=$1',
        [attempt.project_id, 'fallido', publicMessage], tx,
      );
    }
    await query(
      'UPDATE outbox_messages SET published_at=now(), attempts=attempts+1, last_error=$2 WHERE id=$1',
      [message.id, errorText], tx,
    );
  });
}

async function processProcessingAttemptMessage(message) {
  const attempt = await db.transaction(async (tx) => {
    const current = await one('SELECT * FROM processing_attempts WHERE id=$1', [message.aggregate_id], tx);
    if (!current) {
      await query('UPDATE outbox_messages SET published_at=now(), attempts=attempts+1 WHERE id=$1', [message.id], tx);
      return null;
    }
    if (current.status === 'completado' || current.status === 'fallido') {
      await query('UPDATE outbox_messages SET published_at=now(), attempts=attempts+1 WHERE id=$1', [message.id], tx);
      return null;
    }
    const claimed = await one(
      "UPDATE processing_attempts SET status='procesando', processing_started_at=COALESCE(processing_started_at,now()), heartbeat_at=now(), lease_expires_at=now()+INTERVAL '5 minutes' WHERE id=$1 AND (status='pendiente' OR (status='procesando' AND (lease_expires_at IS NULL OR lease_expires_at<=now()))) RETURNING *",
      [message.aggregate_id], tx,
    );
    if (!claimed) return null;
    await query("UPDATE projects SET status='procesando', failure_reason=NULL WHERE id=$1", [claimed.project_id], tx);
    return claimed;
  });
  if (!attempt) return;

  try {
    const project = await one('SELECT * FROM projects WHERE id=$1', [attempt.project_id]);
    if (!project?.audio_file_id) throw new Error('El proyecto no tiene un audio aceptado.');
    const audio = await one(
      "SELECT storage_key FROM audio_files WHERE id=$1 AND project_id=$2 AND status='aceptado'",
      [project.audio_file_id, project.id],
    );
    if (!audio?.storage_key) throw new Error('No se encontró el archivo de audio aceptado.');
    const uploadRoot = path.resolve(uploadDir);
    const audioPath = path.resolve(uploadRoot, audio.storage_key);
    const relativePath = path.relative(uploadRoot, audioPath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
      throw new Error('La clave de almacenamiento queda fuera del directorio permitido.');
    }
    await fs.access(audioPath);

    const predictedNotes = await runBasicPitch(audioPath);
    const notes = predictedNotes.map((note) => ({
      pitch: midiPitchName(Number(note.pitchMidi)),
      startTimeSeconds: Number(note.startTimeSeconds),
      durationSeconds: Number(note.durationSeconds),
      confidence: note.confidence == null || !Number.isFinite(Number(note.confidence))
        ? null
        : Math.max(0, Math.min(1, Number(note.confidence))),
    })).filter((note) => Number.isFinite(note.startTimeSeconds)
      && note.startTimeSeconds >= 0
      && Number.isFinite(note.durationSeconds)
      && note.durationSeconds > 0)
      .map((note) => ({
        ...note,
        isLowConfidence: note.confidence !== null && note.confidence < lowConfidenceThreshold,
      }))
      .sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
    if (!notes.length) throw new Error('Basic Pitch no detectó notas musicales en el audio.');

    await db.transaction(async (tx) => {
      const latest = await one('SELECT COALESCE(MAX(version),0)::int AS version FROM transcriptions WHERE project_id=$1', [project.id], tx);
      const transcription = await one(
        'INSERT INTO transcriptions (project_id,processing_attempt_id,version,is_draft) VALUES ($1,$2,$3,true) RETURNING *',
        [project.id, attempt.id, (latest?.version ?? 0) + 1], tx,
      );
      for (const [index, note] of notes.entries()) {
        await query(
          'INSERT INTO musical_notes (transcription_id,note_index,pitch,start_time_seconds,duration_seconds,confidence,is_estimated,is_low_confidence) VALUES ($1,$2,$3,$4,$5,$6,true,$7)',
          [transcription.id, index, note.pitch, note.startTimeSeconds, note.durationSeconds, note.confidence, note.isLowConfidence], tx,
        );
        if (note.isLowConfidence) {
          await query(
            'INSERT INTO low_confidence_segments (transcription_id,note_index,reason) VALUES ($1,$2,$3)',
            [transcription.id, index, `Confianza estimada ${note.confidence.toFixed(2)}, inferior al umbral ${lowConfidenceThreshold.toFixed(2)}.`], tx,
          );
        }
      }
      await query(
        'INSERT INTO transcription_summaries (transcription_id,notes_count,coverage_estimated_percent) VALUES ($1,$2,NULL)',
        [transcription.id, notes.length], tx,
      );
      await query(
        "UPDATE processing_attempts SET status='completado', transcription_id=$2, error_message=NULL, finished_at=now(), heartbeat_at=now(), lease_expires_at=NULL WHERE id=$1",
        [attempt.id, transcription.id], tx,
      );
      await query(
        "UPDATE projects SET current_transcription_id=$2, status='completado', failure_reason=NULL WHERE id=$1",
        [project.id, transcription.id], tx,
      );
      await query(
        'UPDATE outbox_messages SET published_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1',
        [message.id], tx,
      );
    });
    console.log('Transcripción completada para proyecto ' + project.id + ': ' + notes.length + ' notas.');
  } catch (error) {
    await finishProcessingFailure(
      message,
      'No fue posible generar la transcripción. Verifica que el audio contenga música reconocible e inténtalo de nuevo.',
      error,
    );
  }
}

async function processProcessingQueue() {
  if (processingQueueInProgress) return;
  processingQueueInProgress = true;
  try {
    const pending = await query(
      "SELECT id, aggregate_id, event_type FROM outbox_messages WHERE aggregate_type='processing_attempt' AND published_at IS NULL ORDER BY created_at LIMIT 10",
    );
    for (const message of pending.rows) await processProcessingAttemptMessage(message);
  } finally {
    processingQueueInProgress = false;
  }
}

async function processExportMessage(message) {
  const exportContext = await db.transaction(async (tx) => {
    const item = await one('SELECT * FROM exports WHERE id=$1', [message.aggregate_id], tx);
    if (!item) {
      await query('UPDATE outbox_messages SET published_at=now(), attempts=attempts+1 WHERE id=$1', [message.id], tx);
      return null;
    }
    if (item.status === 'listo' || item.status === 'fallido') {
      await query('UPDATE outbox_messages SET published_at=now(), attempts=attempts+1 WHERE id=$1', [message.id], tx);
      return null;
    }
    await query("UPDATE exports SET status='generando' WHERE id=$1", [item.id], tx);
    const project = await one('SELECT name FROM projects WHERE id=$1', [item.project_id], tx);
    const transcription = await readTranscription(item.transcription_id, tx);
    if (!project || !transcription) throw new Error('No se encontró el proyecto o la transcripción de la exportación.');
    return { item, project, transcription };
  });
  if (!exportContext) return;

  try {
    const { item, project, transcription } = exportContext;
    const fileExtension = item.format === 'midi' ? 'mid' : 'pdf';
    const fileName = `${safeExportBaseName(project.name)}.${fileExtension}`;
    const downloadKey = `exports/${item.id}.${fileExtension}`;
    const absolutePath = path.resolve(uploadDir, downloadKey);
    const relativePath = path.relative(path.resolve(uploadDir), absolutePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
      throw new Error('La ruta de exportación queda fuera del directorio permitido.');
    }
    const fileContents = item.format === 'midi'
      ? makeMidiFile(transcription)
      : makePdfFile(project.name, transcription);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, fileContents);
    const draftNotice = transcription.isDraft
      ? 'Exportación generada desde una transcripción automática. Revisa las notas antes de usarla.'
      : null;

    await db.transaction(async (tx) => {
      await query(
        "UPDATE exports SET status='listo', download_key=$2, file_name=$3, draft_notice=$4 WHERE id=$1",
        [item.id, downloadKey, fileName, draftNotice], tx,
      );
      await query(
        'UPDATE outbox_messages SET published_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1',
        [message.id], tx,
      );
    });
    console.log(`Exportación ${item.format.toUpperCase()} lista para el proyecto ${project.name}.`);
  } catch (error) {
    console.error('Falló la exportación ' + message.aggregate_id + ':', error?.message ?? error);
    await db.transaction(async (tx) => {
      await query("UPDATE exports SET status='fallido' WHERE id=$1", [message.aggregate_id], tx);
      await query(
        'UPDATE outbox_messages SET published_at=now(), attempts=attempts+1, last_error=$2 WHERE id=$1',
        [String(error?.message ?? error).slice(0, 1000), message.id], tx,
      );
    });
  }
}

async function processExportQueue() {
  if (exportQueueInProgress) return;
  exportQueueInProgress = true;
  try {
    const pending = await query(
      "SELECT id, aggregate_id, event_type FROM outbox_messages WHERE aggregate_type='export' AND published_at IS NULL ORDER BY created_at LIMIT 10",
    );
    for (const message of pending.rows) await processExportMessage(message);
  } finally {
    exportQueueInProgress = false;
  }
}

function startExportWorker() {
  const processBatch = () => processExportQueue().catch((error) => {
    console.error('No fue posible procesar la cola de exportación:', error);
  });
  void processBatch();
  const timer = setInterval(processBatch, 1000);
  timer.unref();
  workerTimers.add(timer);
}

function scheduleExportQueue() {
  if (isShuttingDown) return;
  setImmediate(() => {
    if (isShuttingDown) return;
    void processExportQueue().catch((error) => {
      console.error('No fue posible iniciar la generación del archivo:', error);
    });
  });
}

function startProcessingWorker() {
  const processBatch = () => processProcessingQueue().catch((error) => {
    console.error('No fue posible procesar la cola de transcripción:', error);
  });
  void processBatch();
  const timer = setInterval(processBatch, 1000);
  timer.unref();
  workerTimers.add(timer);
}

function scheduleProcessingQueue() {
  if (isShuttingDown) return;
  setImmediate(() => {
    if (isShuttingDown) return;
    void processProcessingQueue().catch((error) => {
      console.error('No fue posible iniciar el procesamiento de audio:', error);
    });
  });
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
      notesCount: Number(summaryRow.notes_count),
      coverageEstimatedPercent: summaryRow.coverage_estimated_percent == null
        ? null
        : Number(summaryRow.coverage_estimated_percent),
      tempoEstimated: row.tempo_estimated == null ? null : Number(row.tempo_estimated),
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
    version: row.version,
    notes: notes.rows.map((note) => ({
      ...note,
      startTimeSeconds: Number(note.startTimeSeconds),
      durationSeconds: Number(note.durationSeconds),
      confidence: note.confidence == null ? null : Number(note.confidence),
    })),
    tempoEstimated: row.tempo_estimated == null ? null : Number(row.tempo_estimated),
    keyEstimated: row.key_estimated, isDraft: row.is_draft, createdAt: row.created_at,
    updatedAt: row.updated_at,
    audioFileUrl: audio ? `/projects/${row.project_id}/audio-files/${audio.id}/file` : null,
    summary, lowConfidenceSegments: segments.rows,
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function passwordMatches(password, encoded) {
  const stored = String(encoded ?? '');
  if (/^\$2[aby]\$/.test(stored)) return bcrypt.compare(password, stored);

  const [algorithm, salt, expectedHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64);
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
     RETURNING id, email, created_at`, [email, await hashPassword(password)],
  ).catch((error) => {
    if (error.code === '23505') fail(409, 'EMAIL_ALREADY_REGISTERED', 'El correo ya está registrado.');
    throw error;
  });
  res.status(201).json({ id: user.id, email: user.email, createdAt: user.created_at });
}));

register('post', '/auth/login', 200, asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') fail(400, 'INVALID_BODY', 'email y password son obligatorios.');
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail(422, 'VALIDATION_ERROR', 'El correo no tiene un formato válido.', [{ field: 'email', message: 'Debe ser un correo válido de hasta 254 caracteres.' }]);
  }
  if (password.length < 1 || password.length > 128) {
    fail(422, 'VALIDATION_ERROR', 'La contraseña no cumple la longitud permitida.', [{ field: 'password', message: 'Debe contener entre 1 y 128 caracteres.' }]);
  }
  const attemptKey = createLoginAttemptKey(req, email);
  checkLoginAttemptLimit(req, res, attemptKey);
  const user = await one('SELECT id, email, password_hash, created_at FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user || !(await passwordMatches(password, user.password_hash))) {
    recordFailedLogin(attemptKey);
    fail(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
  }
  loginFailures.delete(attemptKey);
  const accessToken = jwt.sign({ sub: user.id }, jwtSecret, {
    algorithm: 'HS256',
    audience: jwtAudience,
    expiresIn: jwtExpirationSeconds,
    issuer: jwtIssuer,
    jwtid: crypto.randomUUID(),
  });
  res.json({ accessToken, tokenType: 'Bearer', expiresIn: jwtExpirationSeconds,
    user: { id: user.id, email: user.email, createdAt: user.created_at } });
}));

register('post', '/auth/logout', 204, authenticate, asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at)
     VALUES ($1, $2, to_timestamp($3))
     ON CONFLICT (jti) DO NOTHING`,
    [req.auth.tokenId, req.auth.userId, req.auth.expiresAt],
  );
  res.status(204).end();
}));
register('get', '/auth/me', 200, authenticate, asyncHandler(async (req, res) => {
  const user = await one('SELECT id, email, created_at FROM users WHERE id = $1', [req.auth.userId]);
  if (!user) fail(404, 'USER_NOT_FOUND', 'No se encontró el usuario.');
  res.json({ id: user.id, email: user.email, createdAt: user.created_at });
}));

app.use('/projects', authenticate);

register('get', '/projects', 200, asyncHandler(async (req, res) => {
  const includeArchivedQuery = req.query.includeArchived;
  if (includeArchivedQuery !== undefined && !['true', 'false'].includes(String(includeArchivedQuery))) {
    fail(400, 'INVALID_QUERY', 'includeArchived debe ser true o false.');
  }
  const includeArchived = String(includeArchivedQuery ?? 'false') === 'true';
  const rows = await query(
    `SELECT * FROM projects WHERE owner_id = $1 AND ($2::boolean OR archived_at IS NULL)
     ORDER BY created_at DESC`, [req.auth.userId, includeArchived],
  );
  res.json({ items: rows.rows.map(mapProject) });
}));

register('post', '/projects', 201, asyncHandler(async (req, res) => {
  validateProjectBody(req.body);
  const row = await one(
    `INSERT INTO projects (owner_id, name, description)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.auth.userId, req.body.name.trim(), req.body.description ?? null],
  );
  res.status(201).json(mapProject(row));
}));

register('get', '/projects/:projectId', 200, asyncHandler(async (req, res) => {
  res.json(mapProject(await readProject(req.params.projectId, req.auth.userId)));
}));

register('patch', '/projects/:projectId', 200, asyncHandler(async (req, res) => {
  validateProjectBody(req.body, true);
  const current = await readProject(req.params.projectId, req.auth.userId);
  const fields = [];
  const values = [];
  const add = (column, value) => { values.push(value); fields.push(`${column} = $${values.length}`); };
  if ('name' in req.body) add('name', req.body.name.trim());
  if ('description' in req.body) add('description', req.body.description);
  if ('archived' in req.body) add('archived_at', req.body.archived ? new Date().toISOString() : null);
  values.push(current.id, req.auth.userId);
  const row = await one(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND owner_id = $${values.length} RETURNING *`,
    values,
  );
  res.json(mapProject(row));
}));

register('delete', '/projects/:projectId', 204, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  const result = await db.transaction(async (tx) => {
    const completedExports = await query(
      'SELECT download_key FROM exports WHERE project_id=$1 AND download_key IS NOT NULL',
      [project.id], tx,
    );
    for (const item of completedExports.rows) {
      await query('INSERT INTO storage_deletions (object_key) VALUES ($1)', [item.download_key], tx);
    }
    return query(
      'DELETE FROM projects WHERE id = $1 AND owner_id = $2 RETURNING id',
      [project.id, req.auth.userId], tx,
    );
  });
  if (!result.rows.length) fail(404, 'PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  res.status(204).end();
}));

register('post', '/projects/:projectId/audio-files', 202, audioUpload.single('file'), asyncHandler(async (req, res) => {
  const tempPath = req.file?.path;
  let keepUploadedFile = false;
  try {
    const project = await readProject(req.params.projectId, req.auth.userId);
    if (!req.file) fail(400, 'FILE_REQUIRED', 'Debe adjuntar el archivo en el campo file.');
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
    keepUploadedFile = true;
    scheduleProcessingQueue();
    res.status(202).json({ audioFile: mapAudio(result.audio), projectStatus: 'pendiente', processingStarted: true, requiredConfiguration: [], attempt: mapAttempt(result.attempt) });
  } catch (error) {
    if (tempPath && !keepUploadedFile) await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}));

register('get', '/projects/:projectId/audio-files/:audioFileId', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  assertUuid(req.params.audioFileId, 'audioFileId');
  const audio = await one('SELECT * FROM audio_files WHERE id=$1 AND project_id=$2', [req.params.audioFileId, project.id]);
  if (!audio) fail(404, 'AUDIO_NOT_FOUND', 'No se encontró el audio.');
  res.json(mapAudio(audio));
}));

register('get', '/projects/:projectId/audio-files/:audioFileId/file', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  assertUuid(req.params.audioFileId, 'audioFileId');
  const audio = await one(
    "SELECT storage_key, format FROM audio_files WHERE id=$1 AND project_id=$2 AND status='aceptado'",
    [req.params.audioFileId, project.id],
  );
  if (!audio?.storage_key) fail(404, 'AUDIO_NOT_FOUND', 'No se encontró el audio aceptado.');
  const uploadRoot = path.resolve(uploadDir);
  const audioPath = path.resolve(uploadRoot, audio.storage_key);
  const relativePath = path.relative(uploadRoot, audioPath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    fail(404, 'AUDIO_NOT_FOUND', 'No se encontró el archivo de audio.');
  }
  await fs.access(audioPath).catch(() => fail(404, 'AUDIO_NOT_FOUND', 'No se encontró el archivo de audio.'));
  res.set('Cache-Control', 'private, no-store');
  res.type(audio.format === 'MP3' ? 'audio/mpeg' : 'audio/wav').sendFile(audioPath);
}));

register('put', '/projects/:projectId/processing-configurations/current', 202, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    fail(422, 'VALIDATION_ERROR', 'La configuración debe ser un objeto JSON.', [
      { field: 'body', message: 'Envía un objeto JSON con los parámetros de configuración.' },
    ]);
  }
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
  scheduleProcessingQueue();
  res.status(202).json(mapAttempt(attempt));
}));

register('get', '/projects/:projectId/processing-attempts', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  const rows = await query('SELECT * FROM processing_attempts WHERE project_id=$1 ORDER BY attempt_number DESC', [project.id]);
  res.json({ items: rows.rows.map(mapAttempt) });
}));

register('get', '/projects/:projectId/processing-attempts/:attemptId', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  assertUuid(req.params.attemptId, 'attemptId');
  const attempt = await one('SELECT * FROM processing_attempts WHERE id=$1 AND project_id=$2', [req.params.attemptId, project.id]);
  if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'No se encontró el intento de procesamiento.');
  res.json(mapAttempt(attempt));
}));

register('post', '/projects/:projectId/processing-attempts/:attemptId/retry', 202, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  assertUuid(req.params.attemptId, 'attemptId');
  const attempt = await one('SELECT * FROM processing_attempts WHERE id=$1 AND project_id=$2', [req.params.attemptId, project.id]);
  if (!attempt) fail(404, 'ATTEMPT_NOT_FOUND', 'No se encontró el intento de procesamiento.');
  if (attempt.status !== 'fallido') fail(409, 'RETRY_NOT_ALLOWED', 'Solo se puede reintentar un procesamiento fallido.');
  validateIdempotencyKey(req);
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    fail(422, 'VALIDATION_ERROR', 'El cuerpo de la solicitud debe ser un objeto JSON.', [
      { field: 'body', message: 'Envía un objeto JSON o no incluyas cuerpo.' },
    ]);
  }
  if (req.body?.configuration !== undefined
    && (!req.body.configuration || typeof req.body.configuration !== 'object' || Array.isArray(req.body.configuration))) {
    fail(422, 'VALIDATION_ERROR', 'configuration debe ser un objeto JSON.', [
      { field: 'configuration', message: 'Envía un objeto de configuración.' },
    ]);
  }
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
  scheduleProcessingQueue();
  res.status(202).json(mapAttempt(next));
}));

register('get', '/projects/:projectId/transcriptions/current', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  if (!project.current_transcription_id) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'El proyecto aún no tiene transcripción.');
  const transcription = await readTranscription(project.current_transcription_id);
  if (!transcription) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'No se encontró la transcripción vigente del proyecto.');
  res.set('ETag', `"v${transcription.version}"`).json(transcription);
}));

register('post', '/projects/:projectId/transcriptions/current/revisions', 201, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  if (!Array.isArray(req.body?.notes)) fail(422, 'VALIDATION_ERROR', 'notes debe ser una lista.', [{ field: 'notes', message: 'Debe ser un arreglo.' }]);
  const unknownFields = Object.keys(req.body).filter((field) => field !== 'notes');
  if (unknownFields.length) {
    fail(422, 'VALIDATION_ERROR', 'Hay campos no permitidos.', unknownFields.map((field) => ({ field, message: 'El campo no está permitido.' })));
  }
  if (!project.audio_file_id) fail(409, 'AUDIO_REQUIRED', 'Debe cargar audio antes de guardar una transcripción.');
  const current = project.current_transcription_id ? await readTranscription(project.current_transcription_id) : null;
  if (project.current_transcription_id && !current) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'No se encontró la transcripción vigente del proyecto.');
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
      [project.id, version, current?.tempoEstimated ?? null, current?.keyEstimated ?? null], tx,
    );
    for (const [index, note] of req.body.notes.entries()) {
      await query(
        `INSERT INTO musical_notes (transcription_id,note_index,pitch,start_time_seconds,duration_seconds,
           confidence,is_estimated,is_low_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [transcription.id, index, note.pitch, note.startTimeSeconds, note.durationSeconds,
          note.confidence ?? null, Boolean(note.isEstimated), Boolean(note.isLowConfidence)], tx,
      );
      if (note.isLowConfidence) {
        await query(
          'INSERT INTO low_confidence_segments (transcription_id, note_index, reason) VALUES ($1, $2, $3)',
          [transcription.id, index, 'Marcada para revisión por baja confianza.'], tx,
        );
      }
    }
    await query(
      `INSERT INTO transcription_summaries (transcription_id,notes_count,coverage_estimated_percent)
       VALUES ($1,$2,$3)`,
      [transcription.id, req.body.notes.length, current?.summary?.coverageEstimatedPercent ?? null], tx,
    );
    for (const fieldName of current?.summary?.estimatedFields ?? []) {
      await query(
        'INSERT INTO transcription_summary_estimated_fields (transcription_id, field_name) VALUES ($1, $2)',
        [transcription.id, fieldName], tx,
      );
    }
    await query("UPDATE projects SET current_transcription_id=$1,status='completado',failure_reason=NULL WHERE id=$2", [transcription.id, project.id], tx);
    return transcription.id;
  });
  const response = await readTranscription(saved);
  res.status(201).set('ETag', `"v${response.version}"`).json(response);
}));

register('get', '/projects/:projectId/transcriptions/versions', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  const rows = await query('SELECT id FROM transcriptions WHERE project_id=$1 ORDER BY version DESC', [project.id]);
  const items = [];
  for (const row of rows.rows) items.push(await readTranscription(row.id));
  res.json({ items });
}));

register('post', '/projects/:projectId/exports', 201, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  const format = req.body?.format;
  if (!['midi', 'pdf'].includes(format)) fail(422, 'VALIDATION_ERROR', 'format debe ser midi o pdf.', [{ field: 'format', message: 'Valores permitidos: midi, pdf.' }]);
  if (!project.current_transcription_id) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'El proyecto no tiene transcripción vigente.');
  const transcription = await readTranscription(project.current_transcription_id);
  if (!transcription) fail(404, 'TRANSCRIPTION_NOT_FOUND', 'No se encontró la transcripción vigente del proyecto.');
  const idem = validateIdempotencyKey(req);
  if (idem) {
    const existing = await one('SELECT * FROM exports WHERE project_id=$1 AND idempotency_key=$2', [project.id, idem]);
    if (existing) return res.status(201).json(mapExport(existing));
  }
  const row = await db.transaction(async (tx) => {
    const created = await one(
      `INSERT INTO exports (project_id,transcription_id,format,status,file_name,draft_notice,idempotency_key)
       VALUES ($1,$2,$3,'pendiente',$4,$5,$6) RETURNING *`,
      [project.id, project.current_transcription_id, format,
        `${safeExportBaseName(project.name)}.${format === 'midi' ? 'mid' : 'pdf'}`, null, idem], tx,
    );
    await enqueue(tx, 'export', created.id, 'export.requested', { projectId: project.id, exportId: created.id, format });
    return created;
  });
  scheduleExportQueue();
  res.status(201).json(mapExport(row));
}));

register('get', '/projects/:projectId/exports', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  const rows = await query('SELECT * FROM exports WHERE project_id=$1 ORDER BY created_at DESC', [project.id]);
  res.json({ items: rows.rows.map(mapExport) });
}));

register('get', '/projects/:projectId/exports/:exportId/file', 200, asyncHandler(async (req, res) => {
  const project = await readProject(req.params.projectId, req.auth.userId);
  assertUuid(req.params.exportId, 'exportId');
  const item = await one('SELECT * FROM exports WHERE id=$1 AND project_id=$2', [req.params.exportId, project.id]);
  if (!item) fail(404, 'EXPORT_NOT_FOUND', 'No se encontró la exportación.');
  if (item.status !== 'listo' || !item.download_key) fail(409, 'EXPORT_NOT_READY', 'La exportación todavía no está disponible.');
  const filePath = path.resolve(uploadDir, item.download_key);
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) fail(404, 'EXPORT_NOT_FOUND', 'No se encontró el archivo.');
  await fs.access(filePath).catch(() => fail(404, 'EXPORT_NOT_FOUND', 'No se encontró el archivo.'));
  res.download(filePath, item.file_name ?? path.basename(filePath));
}));

app.use((_req, res) => res.status(404).json(errorPayload('ROUTE_NOT_FOUND', 'No se encontró el endpoint solicitado.')));

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json(errorPayload('INVALID_JSON', 'El cuerpo de la solicitud no es JSON válido.'));
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json(errorPayload('PAYLOAD_TOO_LARGE', 'El archivo excede 100 MiB.'));
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json(errorPayload(error.code, error.message, error.details));
  }
  if (error?.code === '23505') return res.status(409).json(errorPayload('CONFLICT', 'El registro ya existe.'));
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return res.status(422).json(errorPayload('DATA_CONSTRAINT_VIOLATION', 'Los datos no cumplen las reglas del esquema.'));
  }
  console.error(error);
  return res.status(500).json(errorPayload('INTERNAL_ERROR', 'Ocurrió un error interno.'));
});

async function main() {
  validateAuthConfiguration();
  if (!Number.isFinite(lowConfidenceThreshold) || lowConfidenceThreshold < 0 || lowConfidenceThreshold > 1) {
    throw new Error('LOW_CONFIDENCE_THRESHOLD debe ser un número entre 0 y 1.');
  }
  globalThis.__openApiText = await fs.readFile(openApiPath, 'utf8');
  const routeCount = verifyOpenApiContract();
  const tableCount = await initializeDatabase();
  startStorageDeletionWorker();
  startProcessingWorker();
  startExportWorker();
  const server = app.listen(port, () => {
    console.log(`Audio2Score CRUD API escuchando en http://localhost:${port}`);
    console.log(`PostgreSQL conectado; ${tableCount} tablas verificadas; ${routeCount} operaciones OpenAPI registradas.`);
    console.log(`JWT activo; expiración configurada: ${jwtExpirationSeconds} segundos.`);
  });

  const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    for (const timer of workerTimers) clearInterval(timer);
    console.log(`Cerrando la API y la base de datos por ${signal}...`);
    server.close((serverError) => {
      void (async () => {
        try {
          await new Promise((resolve) => setImmediate(resolve));
          while (storageDeletionInProgress || processingQueueInProgress || exportQueueInProgress) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          await db.close();
          console.log('Base de datos cerrada correctamente.');
          if (serverError) process.exitCode = 1;
        } catch (error) {
          console.error('No fue posible cerrar la base de datos limpiamente:', error);
          process.exitCode = 1;
        }
      })();
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (error) => {
  console.error('No fue posible iniciar la API:', error);
  await db.close().catch(() => {});
  process.exitCode = 1;
});
