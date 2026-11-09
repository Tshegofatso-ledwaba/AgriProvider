ALTER TABLE enrolments
  ADD CONSTRAINT enrolments_provider_programme_id_unique
  UNIQUE (provider_user_id, programme_id, id);

CREATE TABLE training_sessions (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  programme_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  starts_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT training_sessions_provider_programme_fk
    FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes(provider_user_id, id),
  CONSTRAINT training_sessions_provider_programme_id_unique
    UNIQUE (provider_user_id, programme_id, id)
);

CREATE INDEX training_sessions_provider_programme_date_idx
  ON training_sessions (provider_user_id, programme_id, starts_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  programme_id UUID NOT NULL,
  session_id UUID NOT NULL,
  enrolment_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
  marked_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_session_scope_fk
    FOREIGN KEY (provider_user_id, programme_id, session_id)
    REFERENCES training_sessions(provider_user_id, programme_id, id),
  CONSTRAINT attendance_enrolment_scope_fk
    FOREIGN KEY (provider_user_id, programme_id, enrolment_id)
    REFERENCES enrolments(provider_user_id, programme_id, id),
  CONSTRAINT attendance_session_enrolment_unique
    UNIQUE (session_id, enrolment_id)
);

CREATE INDEX attendance_provider_session_idx
  ON attendance_records (provider_user_id, session_id, status);

CREATE INDEX attendance_provider_enrolment_idx
  ON attendance_records (provider_user_id, enrolment_id, updated_at DESC);
