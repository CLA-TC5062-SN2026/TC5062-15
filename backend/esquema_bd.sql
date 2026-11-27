-- Audio2Score — esquema relacional (versión revisada) para PostgreSQL 13+
-- Derivado de diagrama_clases_equipo.puml y openapi_equipo.yaml.
-- Los archivos binarios se conservan en almacenamiento de objetos; aquí se guardan
-- sus metadatos y claves internas de almacenamiento.
-- Ver revision_sql.md para el detalle de las correcciones respecto a la versión inicial.

BEGIN;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La tabla % es inmutable: las correcciones crean una nueva versión de transcripción',
        TG_TABLE_NAME;
END;
$$;

-- Cola de borrado de objetos (RF-15 / RNF-05). Cada fila eliminada de audio_files o
-- exports (incluido el borrado en cascada de un proyecto o usuario) registra su clave
-- de almacenamiento en la MISMA transacción; un proceso de limpieza elimina el objeto
-- de forma idempotente y con reintentos. Así no quedan objetos huérfanos.
CREATE TABLE storage_deletions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    object_key    TEXT NOT NULL,
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    CONSTRAINT storage_deletions_attempts_nonnegative CHECK (attempts >= 0)
);
CREATE INDEX ix_storage_deletions_pending
    ON storage_deletions (requested_at) WHERE deleted_at IS NULL;

CREATE FUNCTION enqueue_storage_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    k TEXT := to_jsonb(OLD) ->> TG_ARGV[0];
BEGIN
    IF k IS NOT NULL THEN
        INSERT INTO storage_deletions (object_key) VALUES (k);
    END IF;
    RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(254) NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
    CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$')
);

-- Email único sin distinguir mayúsculas/minúsculas.
CREATE UNIQUE INDEX uq_users_email_ci ON users (lower(email));

-- RF-01-AC-4: el cierre de sesión invalida la sesión. Con JWT Bearer (OpenAPI) se
-- registra el identificador (jti) del token revocado hasta su expiración natural.
-- Tabla técnica: no es un DTO ni una entidad del dominio. Las filas con
-- expires_at vencido pueden purgarse periódicamente.
CREATE TABLE revoked_tokens (
    jti          TEXT PRIMARY KEY,
    user_id      UUID NOT NULL,
    revoked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    CONSTRAINT revoked_tokens_user_fk FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_revoked_tokens_expires ON revoked_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                 UUID NOT NULL,
    name                     VARCHAR(120) NOT NULL,
    description              VARCHAR(1000),
    status                   VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    audio_file_id            UUID,
    current_transcription_id UUID,
    failure_reason           TEXT,
    archived_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT projects_owner_fk FOREIGN KEY (owner_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT projects_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT projects_status_check
        CHECK (status IN ('pendiente', 'procesando', 'completado', 'fallido')),
    CONSTRAINT projects_failure_reason_check
        CHECK (status = 'fallido' OR failure_reason IS NULL),
    -- Un proyecto en procesamiento o completado necesariamente tiene audio.
    CONSTRAINT projects_status_audio_check
        CHECK (status NOT IN ('procesando', 'completado') OR audio_file_id IS NOT NULL),
    -- Un proyecto completado necesariamente tiene transcripción vigente.
    CONSTRAINT projects_completed_transcription_check
        CHECK (status <> 'completado' OR current_transcription_id IS NOT NULL)
);
CREATE INDEX ix_projects_owner_created ON projects (owner_id, created_at DESC);
CREATE INDEX ix_projects_owner_name ON projects (owner_id, name);
-- Listado de proyectos activos (RF-02-AC-2 / RF-15-AC-2).
CREATE INDEX ix_projects_owner_active
    ON projects (owner_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX ix_projects_current_transcription
    ON projects (current_transcription_id) WHERE current_transcription_id IS NOT NULL;

CREATE TRIGGER trg_projects_set_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- audio_files (a lo más un audio por proyecto)
-- ---------------------------------------------------------------------------
CREATE TABLE audio_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    format            VARCHAR(3) NOT NULL,
    size_bytes        BIGINT NOT NULL,
    duration_seconds  NUMERIC(8, 3),
    status            VARCHAR(12) NOT NULL,
    rejection_reason  TEXT,
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    storage_key       TEXT,
    CONSTRAINT audio_files_project_fk FOREIGN KEY (project_id)
        REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT audio_files_id_project_uq UNIQUE (id, project_id),
    CONSTRAINT audio_files_format_check CHECK (format IN ('MP3', 'WAV')),
    -- Los límites (100 MB / 15 min) solo aplican a audios aceptados: un audio
    -- rechazado precisamente por exceder el límite debe poder registrarse.
    CONSTRAINT audio_files_size_check
        CHECK (size_bytes > 0 AND (status = 'rechazado' OR size_bytes <= 104857600)),
    CONSTRAINT audio_files_duration_check
        CHECK (duration_seconds IS NULL
               OR (duration_seconds > 0 AND (status = 'rechazado' OR duration_seconds <= 900))),
    CONSTRAINT audio_files_status_check CHECK (status IN ('aceptado', 'rechazado')),
    CONSTRAINT audio_files_rejection_check
        CHECK ((status = 'rechazado') = (rejection_reason IS NOT NULL)),
    -- Un audio rechazado no se almacena; uno aceptado sí.
    CONSTRAINT audio_files_storage_check
        CHECK (status = 'rechazado' OR storage_key IS NOT NULL)
);

-- El audio original aceptado no se modifica (evidencia de origen de la transcripción).
-- Un registro 'rechazado' sí puede reemplazarse al cargar un nuevo audio:
--   INSERT ... ON CONFLICT (project_id) DO UPDATE SET ... WHERE audio_files.status = 'rechazado'
CREATE FUNCTION audio_files_guard_accepted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'aceptado' THEN
        RAISE EXCEPTION 'El audio aceptado de un proyecto es inmutable; cree un proyecto nuevo para otro audio';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_audio_files_guard_accepted
    BEFORE UPDATE ON audio_files
    FOR EACH ROW EXECUTE FUNCTION audio_files_guard_accepted();
CREATE TRIGGER trg_audio_files_storage_deletion
    BEFORE DELETE ON audio_files
    FOR EACH ROW EXECUTE FUNCTION enqueue_storage_deletion('storage_key');

CREATE FUNCTION audio_files_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) THEN
        RAISE EXCEPTION 'El audio se elimina junto con su proyecto para conservar la trazabilidad';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_audio_files_guard_delete
    BEFORE DELETE ON audio_files
    FOR EACH ROW EXECUTE FUNCTION audio_files_guard_delete();

-- ---------------------------------------------------------------------------
-- transcriptions (versiones inmutables)
-- ---------------------------------------------------------------------------
CREATE TABLE transcriptions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id             UUID NOT NULL,
    processing_attempt_id  UUID,
    version                INTEGER NOT NULL,
    tempo_estimated        NUMERIC(8, 3),
    key_estimated          VARCHAR(32),
    is_draft               BOOLEAN NOT NULL DEFAULT TRUE,
    -- Umbral de baja confianza aplicado al generar esta versión (RF-07-AC-3/RF-10-AC-2).
    -- Congela el criterio con que se calcularon is_low_confidence y los segmentos.
    low_confidence_threshold NUMERIC(5, 4),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ,
    CONSTRAINT transcriptions_project_fk FOREIGN KEY (project_id)
        REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT transcriptions_id_project_uq UNIQUE (id, project_id),
    CONSTRAINT transcriptions_version_positive CHECK (version > 0),
    CONSTRAINT transcriptions_threshold_range
        CHECK (low_confidence_threshold IS NULL OR low_confidence_threshold BETWEEN 0 AND 1),
    CONSTRAINT transcriptions_tempo_positive CHECK (tempo_estimated IS NULL OR tempo_estimated > 0),
    CONSTRAINT transcriptions_project_version_uq UNIQUE (project_id, version)
);
CREATE INDEX ix_transcriptions_project_created
    ON transcriptions (project_id, created_at DESC);
-- Un intento genera a lo más una transcripción.
CREATE UNIQUE INDEX uq_transcriptions_attempt
    ON transcriptions (processing_attempt_id) WHERE processing_attempt_id IS NOT NULL;

-- Identidad y contenido de una versión no cambian una vez creada.
CREATE FUNCTION transcriptions_guard_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.processing_attempt_id IS DISTINCT FROM OLD.processing_attempt_id
       OR NEW.tempo_estimated IS DISTINCT FROM OLD.tempo_estimated
       OR NEW.key_estimated IS DISTINCT FROM OLD.key_estimated
       OR NEW.low_confidence_threshold IS DISTINCT FROM OLD.low_confidence_threshold
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Una versión de transcripción es inmutable; cree una nueva versión';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_transcriptions_immutable
    BEFORE UPDATE ON transcriptions
    FOR EACH ROW EXECUTE FUNCTION transcriptions_guard_immutable();

CREATE FUNCTION transcriptions_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) THEN
        RAISE EXCEPTION 'Una versión de transcripción se elimina junto con su proyecto';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_transcriptions_guard_delete
    BEFORE DELETE ON transcriptions
    FOR EACH ROW EXECUTE FUNCTION transcriptions_guard_delete();

-- ---------------------------------------------------------------------------
-- processing_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE processing_attempts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL,
    status            VARCHAR(12) NOT NULL DEFAULT 'pendiente',
    transcription_id  UUID,
    error_message     TEXT,
    attempt_number    INTEGER NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    configuration     JSONB,
    -- RNF-01: la medición de rendimiento inicia cuando el procesamiento comienza
    -- efectivamente (la creación/encolado del intento es started_at).
    processing_started_at TIMESTAMPTZ,
    -- Columnas técnicas (arquitectura: heartbeat/lease del worker e Idempotency-Key).
    heartbeat_at      TIMESTAMPTZ,
    lease_expires_at  TIMESTAMPTZ,
    idempotency_key   VARCHAR(255),
    CONSTRAINT processing_attempts_project_fk FOREIGN KEY (project_id)
        REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT processing_attempts_id_project_uq UNIQUE (id, project_id),
    CONSTRAINT processing_attempts_status_check
        CHECK (status IN ('pendiente', 'procesando', 'completado', 'fallido')),
    CONSTRAINT processing_attempts_number_positive CHECK (attempt_number > 0),
    CONSTRAINT processing_attempts_project_number_uq UNIQUE (project_id, attempt_number),
    CONSTRAINT processing_attempts_finished_check
        CHECK (finished_at IS NULL OR finished_at >= started_at),
    -- finished_at presente si y solo si el intento terminó.
    CONSTRAINT processing_attempts_finished_status_check
        CHECK ((status IN ('completado', 'fallido')) = (finished_at IS NOT NULL)),
    CONSTRAINT processing_attempts_error_check
        CHECK (status = 'fallido' OR error_message IS NULL),
    CONSTRAINT processing_attempts_completed_check
        CHECK (status <> 'completado' OR transcription_id IS NOT NULL),
    CONSTRAINT processing_attempts_processing_start_check
        CHECK (processing_started_at IS NULL OR processing_started_at >= started_at),
    CONSTRAINT processing_attempts_processing_finish_check
        CHECK (processing_started_at IS NULL OR finished_at IS NULL
               OR finished_at >= processing_started_at),
    CONSTRAINT processing_attempts_pending_start_check
        CHECK (status <> 'pendiente' OR processing_started_at IS NULL),
    CONSTRAINT processing_attempts_running_start_check
        CHECK (status NOT IN ('procesando', 'completado') OR processing_started_at IS NOT NULL),
    CONSTRAINT processing_attempts_idempotency_len
        CHECK (idempotency_key IS NULL OR length(idempotency_key) >= 16)
);
CREATE INDEX ix_processing_attempts_project_started
    ON processing_attempts (project_id, started_at DESC);
CREATE INDEX ix_processing_attempts_status_started
    ON processing_attempts (status, started_at);
-- Un solo intento activo por proyecto (los reintentos solo tras un fallo).
CREATE UNIQUE INDEX uq_processing_attempts_one_active
    ON processing_attempts (project_id) WHERE status IN ('pendiente', 'procesando');
-- Un intento produce a lo más una transcripción.
CREATE UNIQUE INDEX uq_processing_attempts_transcription
    ON processing_attempts (transcription_id) WHERE transcription_id IS NOT NULL;
-- Idempotency-Key: la misma solicitud reenviada no duplica el intento.
CREATE UNIQUE INDEX uq_processing_attempts_idempotency
    ON processing_attempts (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Referencias circulares. Todas son compuestas con (id, project_id) para garantizar
-- que el recurso referenciado pertenece al MISMO proyecto. Se declaran DEFERRABLE
-- para que el borrado en cascada de un proyecto y las inserciones circulares
-- (intento <-> transcripción) se validen al finalizar la transacción.
-- (ON DELETE SET NULL no es aplicable a FK compuestas con project_id NOT NULL
--  en PostgreSQL 13/14; las versiones y audios no se eliminan individualmente.)
-- ---------------------------------------------------------------------------
ALTER TABLE transcriptions
    ADD CONSTRAINT transcriptions_attempt_fk
    FOREIGN KEY (processing_attempt_id, project_id)
    REFERENCES processing_attempts (id, project_id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE processing_attempts
    ADD CONSTRAINT processing_attempts_transcription_fk
    FOREIGN KEY (transcription_id, project_id)
    REFERENCES transcriptions (id, project_id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE projects
    ADD CONSTRAINT projects_audio_file_fk
    FOREIGN KEY (audio_file_id, id)
    REFERENCES audio_files (id, project_id)
    DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE projects
    ADD CONSTRAINT projects_current_transcription_fk
    FOREIGN KEY (current_transcription_id, id)
    REFERENCES transcriptions (id, project_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- musical_notes
-- ---------------------------------------------------------------------------
CREATE TABLE musical_notes (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transcription_id       UUID NOT NULL,
    note_index             INTEGER NOT NULL,
    pitch                  VARCHAR(16) NOT NULL,
    start_time_seconds     NUMERIC(12, 6) NOT NULL,
    duration_seconds       NUMERIC(12, 6) NOT NULL,
    confidence             NUMERIC(5, 4),
    is_estimated           BOOLEAN NOT NULL DEFAULT FALSE,
    is_low_confidence      BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT musical_notes_transcription_fk FOREIGN KEY (transcription_id)
        REFERENCES transcriptions (id) ON DELETE CASCADE,
    -- Notación científica de alturas (ej. C4, F#3, Bb2); rango MIDI C-1..B9.
    CONSTRAINT musical_notes_pitch_format
        CHECK (pitch ~ '^[A-G](##?|bb?)?(-1|[0-9])$'),
    CONSTRAINT musical_notes_index_nonnegative CHECK (note_index >= 0),
    CONSTRAINT musical_notes_start_nonnegative CHECK (start_time_seconds >= 0),
    CONSTRAINT musical_notes_duration_positive CHECK (duration_seconds > 0),
    CONSTRAINT musical_notes_confidence_range
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    CONSTRAINT musical_notes_transcription_index_uq UNIQUE (transcription_id, note_index)
);
CREATE INDEX ix_musical_notes_transcription_order
    ON musical_notes (transcription_id, note_index);
CREATE TRIGGER trg_musical_notes_immutable
    BEFORE UPDATE ON musical_notes
    FOR EACH ROW EXECUTE FUNCTION forbid_update();

CREATE FUNCTION forbid_transcription_child_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM transcriptions t WHERE t.id = OLD.transcription_id) THEN
        RAISE EXCEPTION 'El contenido de una versión es inmutable; elimine el proyecto para borrar sus datos';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER trg_musical_notes_guard_delete
    BEFORE DELETE ON musical_notes
    FOR EACH ROW EXECUTE FUNCTION forbid_transcription_child_delete();

-- ---------------------------------------------------------------------------
-- transcription_summaries (+ campos marcados como estimados)
-- ---------------------------------------------------------------------------
CREATE TABLE transcription_summaries (
    transcription_id             UUID PRIMARY KEY,
    notes_count                  INTEGER NOT NULL,
    coverage_estimated_percent   NUMERIC(5, 2),
    -- tempo y tonalidad del resumen se toman de transcriptions (fuente única).
    CONSTRAINT transcription_summaries_transcription_fk FOREIGN KEY (transcription_id)
        REFERENCES transcriptions (id) ON DELETE CASCADE,
    CONSTRAINT transcription_summaries_notes_nonnegative CHECK (notes_count >= 0),
    CONSTRAINT transcription_summaries_coverage_range
        CHECK (coverage_estimated_percent IS NULL OR coverage_estimated_percent BETWEEN 0 AND 100)
);
CREATE TRIGGER trg_transcription_summaries_immutable
    BEFORE UPDATE ON transcription_summaries
    FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER trg_transcription_summaries_guard_delete
    BEFORE DELETE ON transcription_summaries
    FOR EACH ROW EXECUTE FUNCTION forbid_transcription_child_delete();

CREATE TABLE transcription_summary_estimated_fields (
    transcription_id UUID NOT NULL,
    field_name       VARCHAR(32) NOT NULL,
    PRIMARY KEY (transcription_id, field_name),
    CONSTRAINT summary_estimated_fields_summary_fk FOREIGN KEY (transcription_id)
        REFERENCES transcription_summaries (transcription_id) ON DELETE CASCADE,
    CONSTRAINT summary_estimated_fields_name_check
        CHECK (field_name IN ('coverageEstimatedPercent', 'tempoEstimated', 'keyEstimated'))
);
CREATE TRIGGER trg_summary_estimated_fields_guard_delete
    BEFORE DELETE ON transcription_summary_estimated_fields
    FOR EACH ROW EXECUTE FUNCTION forbid_transcription_child_delete();

-- ---------------------------------------------------------------------------
-- low_confidence_segments (apuntan a una nota existente de la MISMA transcripción)
-- ---------------------------------------------------------------------------
CREATE TABLE low_confidence_segments (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transcription_id   UUID NOT NULL,
    note_index         INTEGER NOT NULL,
    reason             TEXT NOT NULL,
    CONSTRAINT low_confidence_segments_note_fk
        FOREIGN KEY (transcription_id, note_index)
        REFERENCES musical_notes (transcription_id, note_index) ON DELETE CASCADE,
    CONSTRAINT low_confidence_segments_note_index_check CHECK (note_index >= 0),
    CONSTRAINT low_confidence_segments_reason_not_blank CHECK (length(trim(reason)) > 0),
    CONSTRAINT low_confidence_segments_note_uq UNIQUE (transcription_id, note_index)
);
CREATE TRIGGER trg_low_confidence_segments_immutable
    BEFORE UPDATE ON low_confidence_segments
    FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER trg_low_confidence_segments_guard_delete
    BEFORE DELETE ON low_confidence_segments
    FOR EACH ROW EXECUTE FUNCTION forbid_transcription_child_delete();

-- ---------------------------------------------------------------------------
-- exports
-- ---------------------------------------------------------------------------
CREATE TABLE exports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL,
    transcription_id  UUID,
    format            VARCHAR(4) NOT NULL,
    status            VARCHAR(10) NOT NULL DEFAULT 'pendiente',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    download_key      TEXT,
    file_name         TEXT,
    draft_notice      TEXT,
    idempotency_key   VARCHAR(255),
    CONSTRAINT exports_project_fk FOREIGN KEY (project_id)
        REFERENCES projects (id) ON DELETE CASCADE,
    -- La transcripción exportada debe pertenecer al mismo proyecto.
    CONSTRAINT exports_transcription_fk FOREIGN KEY (transcription_id, project_id)
        REFERENCES transcriptions (id, project_id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT exports_format_check CHECK (format IN ('midi', 'pdf')),
    CONSTRAINT exports_status_check
        CHECK (status IN ('pendiente', 'generando', 'listo', 'fallido')),
    CONSTRAINT exports_ready_file_check
        CHECK (status <> 'listo' OR download_key IS NOT NULL),
    CONSTRAINT exports_ready_transcription_check
        CHECK (status <> 'listo' OR transcription_id IS NOT NULL),
    CONSTRAINT exports_idempotency_len
        CHECK (idempotency_key IS NULL OR length(idempotency_key) >= 16)
);
CREATE INDEX ix_exports_project_created ON exports (project_id, created_at DESC);
CREATE INDEX ix_exports_transcription ON exports (transcription_id);
CREATE UNIQUE INDEX uq_exports_idempotency
    ON exports (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER trg_exports_storage_deletion
    BEFORE DELETE ON exports
    FOR EACH ROW EXECUTE FUNCTION enqueue_storage_deletion('download_key');

-- ---------------------------------------------------------------------------
-- Consistencia (verificada al hacer commit)
-- ---------------------------------------------------------------------------
-- 1) El vínculo intento <-> transcripción debe ser el mismo en ambos sentidos.
--    Debe escribirse en una sola transacción (worker: transcripción + intento).
CREATE FUNCTION check_attempt_transcription_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'processing_attempts' THEN
        IF NEW.transcription_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM transcriptions t
            WHERE t.id = NEW.transcription_id AND t.processing_attempt_id = NEW.id) THEN
            RAISE EXCEPTION 'Vínculo intento/transcripción inconsistente (intento %)', NEW.id;
        END IF;
    ELSE
        IF NEW.processing_attempt_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM processing_attempts a
            WHERE a.id = NEW.processing_attempt_id AND a.transcription_id = NEW.id) THEN
            RAISE EXCEPTION 'Vínculo intento/transcripción inconsistente (transcripción %)', NEW.id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_attempt_link_check
    AFTER INSERT OR UPDATE ON processing_attempts
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_attempt_transcription_link();
CREATE CONSTRAINT TRIGGER trg_transcription_link_check
    AFTER INSERT OR UPDATE ON transcriptions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_attempt_transcription_link();

-- 2) La referencia duplicada Project.audioFileId ↔ AudioFile.projectId
--    debe coincidir en ambos sentidos. Evita que exista audio de un proyecto
--    mientras Project.audioFileId queda NULL o apunta a otro registro.
CREATE FUNCTION check_project_audio_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    target_project_id UUID;
    project_audio_id UUID;
    actual_audio_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'projects' THEN
        target_project_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSE
        target_project_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
    END IF;

    SELECT p.audio_file_id INTO project_audio_id
    FROM projects p WHERE p.id = target_project_id;
    IF NOT FOUND THEN
        RETURN NULL; -- Eliminación en cascada del proyecto.
    END IF;

    SELECT a.id INTO actual_audio_id
    FROM audio_files a WHERE a.project_id = target_project_id;
    IF project_audio_id IS DISTINCT FROM actual_audio_id THEN
        RAISE EXCEPTION 'Project.audio_file_id no coincide con el AudioFile del proyecto %',
            target_project_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_project_audio_link_check
    AFTER INSERT OR UPDATE OR DELETE ON projects
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_project_audio_link();
CREATE CONSTRAINT TRIGGER trg_audio_project_link_check
    AFTER INSERT OR UPDATE OR DELETE ON audio_files
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_project_audio_link();

-- 3) notes_count del resumen debe coincidir con las notas almacenadas.
CREATE FUNCTION check_summary_notes_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    target_transcription_id UUID;
    expected_notes_count INTEGER;
    actual_notes_count BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'transcription_summaries' THEN
        target_transcription_id := CASE WHEN TG_OP = 'DELETE'
            THEN OLD.transcription_id ELSE NEW.transcription_id END;
    ELSE
        target_transcription_id := CASE WHEN TG_OP = 'DELETE'
            THEN OLD.transcription_id ELSE NEW.transcription_id END;
    END IF;

    SELECT s.notes_count INTO expected_notes_count
    FROM transcription_summaries s
    WHERE s.transcription_id = target_transcription_id;
    IF NOT FOUND THEN
        RETURN NULL; -- El resumen es opcional.
    END IF;

    SELECT count(*) INTO actual_notes_count
    FROM musical_notes n WHERE n.transcription_id = target_transcription_id;
    IF actual_notes_count <> expected_notes_count THEN
        RAISE EXCEPTION 'notes_count no coincide con las notas de la transcripción %',
            target_transcription_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_summary_notes_count_check
    AFTER INSERT ON transcription_summaries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_summary_notes_count();
CREATE CONSTRAINT TRIGGER trg_summary_note_rows_check
    AFTER INSERT OR DELETE ON musical_notes
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION check_summary_notes_count();

-- ---------------------------------------------------------------------------
-- outbox_messages: tabla técnica requerida por la arquitectura (outbox transaccional).
-- No es un DTO del OpenAPI ni una entidad visible del dominio.
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type    VARCHAR(80) NOT NULL,
    aggregate_id      UUID NOT NULL,
    event_type        VARCHAR(120) NOT NULL,
    payload           JSONB NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at      TIMESTAMPTZ,
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    CONSTRAINT outbox_attempts_nonnegative CHECK (attempts >= 0)
);
CREATE INDEX ix_outbox_unpublished_created
    ON outbox_messages (created_at)
    WHERE published_at IS NULL;

COMMIT;
