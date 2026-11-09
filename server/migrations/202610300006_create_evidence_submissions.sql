DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'enrolments'::regclass
      AND conname = 'enrolments_provider_programme_id_unique'
      AND pg_get_constraintdef(oid) = 'UNIQUE (provider_user_id, programme_id, id)'
  ) THEN
    ALTER TABLE enrolments
      ADD CONSTRAINT enrolments_provider_programme_id_unique
      UNIQUE (provider_user_id, programme_id, id);
  END IF;
END
$$;

CREATE TABLE evidence_submissions (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  programme_id UUID NOT NULL,
  enrolment_id UUID NOT NULL,
  requirement_id UUID NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  file_size BIGINT NOT NULL CHECK (file_size BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_provider TEXT NOT NULL CHECK (char_length(storage_provider) BETWEEN 1 AND 80),
  storage_key TEXT NOT NULL CHECK (char_length(storage_key) BETWEEN 1 AND 255),
  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'CORRECTION_REQUIRED', 'APPROVED')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (provider_user_id, programme_id, enrolment_id)
    REFERENCES enrolments (provider_user_id, programme_id, id),
  FOREIGN KEY (provider_user_id, programme_id, requirement_id)
    REFERENCES programme_evidence_requirements (provider_user_id, programme_id, id),
  UNIQUE (enrolment_id, requirement_id, version),
  UNIQUE (storage_provider, storage_key)
);

CREATE INDEX evidence_submissions_enrolment_requirement_version_idx
  ON evidence_submissions (provider_user_id, enrolment_id, requirement_id, version DESC);

CREATE INDEX evidence_submissions_provider_created_idx
  ON evidence_submissions (provider_user_id, created_at DESC);
