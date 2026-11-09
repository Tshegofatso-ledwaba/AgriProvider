ALTER TABLE programmes
  ADD CONSTRAINT programmes_provider_id_unique UNIQUE (provider_user_id, id);

ALTER TABLE learners
  ADD CONSTRAINT learners_provider_id_unique UNIQUE (provider_user_id, id);

CREATE TABLE enrolments (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL,
  programme_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enrolments_provider_learner_fk
    FOREIGN KEY (provider_user_id, learner_id)
    REFERENCES learners(provider_user_id, id),
  CONSTRAINT enrolments_provider_programme_fk
    FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes(provider_user_id, id)
);

CREATE UNIQUE INDEX enrolments_active_pair_unique
  ON enrolments (provider_user_id, learner_id, programme_id)
  WHERE status = 'active';

CREATE INDEX enrolments_provider_active_created_idx
  ON enrolments (provider_user_id, created_at DESC)
  WHERE status = 'active';

CREATE INDEX enrolments_provider_learner_idx
  ON enrolments (provider_user_id, learner_id, created_at DESC);

CREATE INDEX enrolments_provider_programme_idx
  ON enrolments (provider_user_id, programme_id, created_at DESC);
