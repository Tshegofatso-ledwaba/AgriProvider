ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS learner_user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS learners_learner_user_idx
  ON learners (learner_user_id)
  WHERE learner_user_id IS NOT NULL;
