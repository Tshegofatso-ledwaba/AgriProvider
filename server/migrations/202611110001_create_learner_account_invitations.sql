CREATE TABLE learner_account_invitations (
  id UUID PRIMARY KEY,
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  provider_user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX learner_account_invitations_one_open_per_learner
  ON learner_account_invitations (learner_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX learner_account_invitations_provider_idx
  ON learner_account_invitations (provider_user_id, created_at DESC);