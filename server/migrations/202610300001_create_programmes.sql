CREATE TABLE programmes (
  id UUID PRIMARY KEY,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX programmes_provider_active_created_idx
  ON programmes (provider_user_id, created_at DESC)
  WHERE archived_at IS NULL;
