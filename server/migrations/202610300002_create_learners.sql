CREATE TABLE learners (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_reference TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 32),
  email TEXT CHECK (email IS NULL OR char_length(email) <= 254),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  UNIQUE (provider_user_id, learner_reference)
);

CREATE INDEX learners_provider_active_created_idx
  ON learners (provider_user_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX learners_provider_active_name_idx
  ON learners (provider_user_id, lower(full_name))
  WHERE archived_at IS NULL;

CREATE INDEX learners_provider_active_email_idx
  ON learners (provider_user_id, lower(email))
  WHERE archived_at IS NULL AND email IS NOT NULL;

CREATE INDEX learners_provider_active_phone_idx
  ON learners (provider_user_id, phone)
  WHERE archived_at IS NULL AND phone IS NOT NULL;
