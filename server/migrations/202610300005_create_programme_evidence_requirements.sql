CREATE TABLE programme_evidence_requirements (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL,
  programme_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  guidance TEXT CHECK (guidance IS NULL OR char_length(guidance) <= 2000),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes (provider_user_id, id) ON DELETE CASCADE,
  UNIQUE (provider_user_id, programme_id, id)
);

CREATE INDEX programme_evidence_requirements_active_idx
  ON programme_evidence_requirements (provider_user_id, programme_id, created_at, id)
  WHERE archived_at IS NULL;
