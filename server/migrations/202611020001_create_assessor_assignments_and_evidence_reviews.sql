ALTER TABLE users
  DROP CONSTRAINT users_role_check,
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('provider', 'assessor', 'qa', 'admin', 'learner'));

ALTER TABLE evidence_submissions
  ADD CONSTRAINT evidence_submissions_id_version_unique UNIQUE (id, version);

CREATE TABLE programme_assessor_assignments (
  id UUID PRIMARY KEY,
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  assessor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,
  CHECK ((status = 'ACTIVE' AND deactivated_at IS NULL)
    OR (status = 'INACTIVE' AND deactivated_at IS NOT NULL)),
  UNIQUE (id, programme_id, assessor_user_id)
);

CREATE UNIQUE INDEX programme_assessor_assignments_active_pair_unique
  ON programme_assessor_assignments (programme_id, assessor_user_id)
  WHERE status = 'ACTIVE' AND deactivated_at IS NULL;

CREATE INDEX programme_assessor_assignments_assessor_active_idx
  ON programme_assessor_assignments (assessor_user_id, programme_id)
  WHERE status = 'ACTIVE' AND deactivated_at IS NULL;

CREATE TABLE evidence_reviews (
  id UUID PRIMARY KEY,
  evidence_submission_id UUID NOT NULL,
  submission_version INTEGER NOT NULL CHECK (submission_version > 0),
  programme_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  assessor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'CORRECTION_REQUESTED')),
  feedback TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (feedback IS NULL OR char_length(feedback) <= 2000),
  CHECK (decision <> 'CORRECTION_REQUESTED'
    OR (feedback IS NOT NULL AND char_length(btrim(feedback)) > 0)),
  FOREIGN KEY (evidence_submission_id, submission_version)
    REFERENCES evidence_submissions (id, version) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, programme_id, assessor_user_id)
    REFERENCES programme_assessor_assignments (id, programme_id, assessor_user_id) ON DELETE RESTRICT,
  UNIQUE (evidence_submission_id, submission_version)
);

CREATE INDEX evidence_reviews_submission_version_idx
  ON evidence_reviews (evidence_submission_id, submission_version DESC);

CREATE INDEX evidence_reviews_assessor_reviewed_idx
  ON evidence_reviews (assessor_user_id, reviewed_at DESC);