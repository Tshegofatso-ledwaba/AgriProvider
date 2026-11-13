CREATE OR REPLACE FUNCTION agri_protect_eligibility_configuration_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'INACTIVE') THEN
    RAISE EXCEPTION 'Approved eligibility configurations are immutable; create a new version';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    IF current_setting('app.certification_approval_authority', TRUE) IS DISTINCT FROM 'admin'
      OR current_setting('app.certification_actor', TRUE) IS DISTINCT FROM NEW.approved_by::TEXT
      OR NEW.approval_authority IS DISTINCT FROM 'Administrator' THEN
      RAISE EXCEPTION 'Eligibility configuration approval requires an authenticated Administrator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE certificate_eligibility_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  learner_id UUID NOT NULL,
  enrolment_id UUID NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL,
  eligibility_configuration_id UUID NOT NULL REFERENCES eligibility_rule_configurations(id) ON DELETE RESTRICT,
  credential_key TEXT NOT NULL CHECK (credential_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  credential_type TEXT NOT NULL CHECK (credential_type IN ('MILESTONE', 'FINAL')),
  credential_title TEXT NOT NULL CHECK (char_length(btrim(credential_title)) BETWEEN 1 AND 160),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  criteria_snapshot JSONB NOT NULL CHECK (jsonb_typeof(criteria_snapshot) = 'object'),
  evidence_snapshot JSONB NOT NULL CHECK (jsonb_typeof(evidence_snapshot) = 'array'),
  comments TEXT NOT NULL CHECK (char_length(btrim(comments)) BETWEEN 1 AND 2000),
  qa_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (provider_user_id, learner_id)
    REFERENCES learners (provider_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes (provider_user_id, id) ON DELETE RESTRICT,
  CHECK (decision <> 'APPROVED' OR blockers = '[]'::jsonb)
);

CREATE INDEX certificate_eligibility_reviews_qa_idx
  ON certificate_eligibility_reviews (qa_user_id, reviewed_at DESC);
CREATE INDEX certificate_eligibility_reviews_admin_idx
  ON certificate_eligibility_reviews (decision, reviewed_at DESC);
CREATE INDEX certificate_eligibility_reviews_learner_idx
  ON certificate_eligibility_reviews (learner_id, programme_id, credential_key, reviewed_at DESC);

CREATE TABLE certificate_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eligibility_review_id UUID NOT NULL UNIQUE
    REFERENCES certificate_eligibility_reviews(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  comments TEXT,
  admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (comments IS NULL OR char_length(btrim(comments)) BETWEEN 1 AND 2000),
  CHECK (decision <> 'REJECTED' OR comments IS NOT NULL)
);

CREATE TABLE certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eligibility_review_id UUID NOT NULL UNIQUE
    REFERENCES certificate_eligibility_reviews(id) ON DELETE RESTRICT,
  authorization_id UUID NOT NULL UNIQUE
    REFERENCES certificate_authorizations(id) ON DELETE RESTRICT,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  learner_id UUID NOT NULL,
  enrolment_id UUID NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL,
  credential_key TEXT NOT NULL CHECK (credential_key ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  certificate_type TEXT NOT NULL CHECK (certificate_type IN ('MILESTONE', 'FINAL')),
  certificate_title TEXT NOT NULL CHECK (char_length(btrim(certificate_title)) BETWEEN 1 AND 160),
  learner_name TEXT NOT NULL CHECK (char_length(btrim(learner_name)) BETWEEN 1 AND 120),
  learner_reference TEXT NOT NULL,
  programme_name TEXT NOT NULL CHECK (char_length(btrim(programme_name)) BETWEEN 1 AND 160),
  verification_reference TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issuer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  issuer_name TEXT NOT NULL CHECK (char_length(btrim(issuer_name)) BETWEEN 1 AND 120),
  issuer_title TEXT NOT NULL CHECK (char_length(btrim(issuer_title)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'REVOKED', 'SUPERSEDED')),
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_certificate_id UUID REFERENCES certificates(id) ON DELETE RESTRICT,
  revoked_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (provider_user_id, learner_id)
    REFERENCES learners (provider_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes (provider_user_id, id) ON DELETE RESTRICT,
  CHECK (supersedes_certificate_id IS NULL OR supersedes_certificate_id <> id),
  CHECK ((status = 'REVOKED' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
    OR (status <> 'REVOKED' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL))
);

CREATE UNIQUE INDEX certificates_one_current_credential_idx
  ON certificates (learner_id, programme_id, credential_key)
  WHERE status = 'ISSUED';
CREATE INDEX certificates_learner_history_idx
  ON certificates (learner_id, issued_at DESC);
CREATE INDEX certificates_programme_issue_idx
  ON certificates (programme_id, issued_at DESC);

CREATE TABLE certificate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eligibility_configuration_id UUID REFERENCES eligibility_rule_configurations(id) ON DELETE RESTRICT,
  eligibility_review_id UUID REFERENCES certificate_eligibility_reviews(id) ON DELETE RESTRICT,
  authorization_id UUID REFERENCES certificate_authorizations(id) ON DELETE RESTRICT,
  certificate_id UUID REFERENCES certificates(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('provider', 'qa', 'admin', 'system')),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'RULES_CREATED', 'RULES_SUBMITTED', 'RULES_APPROVED', 'RULES_REJECTED',
    'QA_ELIGIBILITY_APPROVED', 'QA_ELIGIBILITY_REJECTED',
    'ADMIN_ISSUANCE_APPROVED', 'ADMIN_ISSUANCE_REJECTED',
    'CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED', 'CERTIFICATE_SUPERSEDED'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (eligibility_configuration_id IS NOT NULL OR eligibility_review_id IS NOT NULL
    OR authorization_id IS NOT NULL OR certificate_id IS NOT NULL)
);

CREATE INDEX certificate_events_review_history_idx
  ON certificate_events (eligibility_review_id, created_at, id)
  WHERE eligibility_review_id IS NOT NULL;
CREATE INDEX certificate_events_certificate_history_idx
  ON certificate_events (certificate_id, created_at, id)
  WHERE certificate_id IS NOT NULL;
CREATE INDEX certificate_events_configuration_history_idx
  ON certificate_events (eligibility_configuration_id, created_at, id)
  WHERE eligibility_configuration_id IS NOT NULL;

CREATE FUNCTION agri_prevent_certificate_history_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certificate decisions and events are immutable';
END;
$$;

CREATE FUNCTION agri_protect_certificate_content() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'revoked_by', 'revoked_at', 'revocation_reason', 'updated_by', 'updated_at'])
      IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'revoked_by', 'revoked_at', 'revocation_reason', 'updated_by', 'updated_at']) THEN
    RAISE EXCEPTION 'Certificate content is immutable after issuance';
  END IF;
  IF OLD.status <> 'ISSUED' OR NEW.status NOT IN ('REVOKED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Only an issued certificate may be revoked or superseded';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER certificates_protect_content
  BEFORE UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION agri_protect_certificate_content();

CREATE TRIGGER certificate_eligibility_reviews_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON certificate_eligibility_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_certificate_history_mutation();
CREATE TRIGGER certificate_authorizations_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON certificate_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_certificate_history_mutation();
CREATE TRIGGER certificate_events_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON certificate_events
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_certificate_history_mutation();

CREATE FUNCTION agri_validate_certificate_eligibility_review() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  valid_scope BOOLEAN;
  valid_credential BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM users qa
      JOIN qa_programme_assignments assignment
        ON assignment.qa_user_id = qa.id AND assignment.programme_id = NEW.programme_id
       AND assignment.status = 'ACTIVE' AND assignment.deactivated_at IS NULL
      JOIN eligibility_rule_configurations configuration
        ON configuration.id = NEW.eligibility_configuration_id
       AND configuration.programme_id = NEW.programme_id AND configuration.status = 'APPROVED'
      JOIN enrolments enrolment ON enrolment.id = NEW.enrolment_id
       AND enrolment.provider_user_id = NEW.provider_user_id
       AND enrolment.learner_id = NEW.learner_id AND enrolment.programme_id = NEW.programme_id
       AND enrolment.status = 'active'
     WHERE qa.id = NEW.qa_user_id AND qa.role = 'qa' AND qa.is_active = TRUE
  ) INTO valid_scope;
  IF NOT valid_scope THEN
    RAISE EXCEPTION 'Certificate eligibility review is outside active QA or learner scope';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM eligibility_rule_configurations configuration,
      LATERAL jsonb_array_elements(configuration.criteria -> 'certificates') AS entry(item)
     WHERE configuration.id = NEW.eligibility_configuration_id
       AND configuration.status = 'APPROVED'
       AND configuration.criteria = NEW.criteria_snapshot
       AND entry.item ->> 'key' = NEW.credential_key
       AND entry.item ->> 'type' = NEW.credential_type
       AND entry.item ->> 'title' = NEW.credential_title
  ) INTO valid_credential;
  IF NOT valid_credential THEN
    RAISE EXCEPTION 'QA eligibility review must match an approved configured certificate';
  END IF;
  IF NEW.decision = 'APPROVED' AND NEW.blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Eligibility with outstanding conditions cannot be approved';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER certificate_eligibility_reviews_validate
  BEFORE INSERT ON certificate_eligibility_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_validate_certificate_eligibility_review();

CREATE FUNCTION agri_validate_certificate_authorization() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  authorized_admin BOOLEAN;
  qa_approved BOOLEAN;
BEGIN
  SELECT u.role = 'admin' AND u.is_active = TRUE
    INTO authorized_admin
    FROM users u WHERE u.id = NEW.admin_user_id;
  SELECT r.decision = 'APPROVED'
    INTO qa_approved
    FROM certificate_eligibility_reviews r WHERE r.id = NEW.eligibility_review_id;
  IF NOT COALESCE(authorized_admin, FALSE) THEN
    RAISE EXCEPTION 'Certificate authorization requires an active Administrator';
  END IF;
  IF NOT COALESCE(qa_approved, FALSE) THEN
    RAISE EXCEPTION 'Certificate authorization requires approved QA eligibility';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER certificate_authorizations_validate
  BEFORE INSERT ON certificate_authorizations
  FOR EACH ROW EXECUTE FUNCTION agri_validate_certificate_authorization();

CREATE FUNCTION agri_validate_certificate_issue() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  authorization_row RECORD;
  issuer_role TEXT;
  issuer_name_value TEXT;
  credential_rule JSONB;
BEGIN
  SELECT authorization.decision AS authorization_decision, authorization.admin_user_id,
    review.decision AS qa_decision, review.blockers, review.learner_id, review.provider_user_id,
    review.enrolment_id, review.programme_id, review.credential_key, review.credential_type,
    review.credential_title, review.eligibility_configuration_id
    INTO authorization_row
    FROM certificate_authorizations authorization
    JOIN certificate_eligibility_reviews review
      ON review.id = authorization.eligibility_review_id
   WHERE authorization.id = NEW.authorization_id
     AND review.id = NEW.eligibility_review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificate authorization or eligibility review not found';
  END IF;
  IF NEW.status <> 'ISSUED'
    OR authorization_row.authorization_decision <> 'APPROVED'
    OR authorization_row.qa_decision <> 'APPROVED'
    OR authorization_row.blockers <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Certificate requires approved QA eligibility and Administrator authorization';
  END IF;
  IF authorization_row.learner_id IS DISTINCT FROM NEW.learner_id
    OR authorization_row.provider_user_id IS DISTINCT FROM NEW.provider_user_id
    OR authorization_row.enrolment_id IS DISTINCT FROM NEW.enrolment_id
    OR authorization_row.programme_id IS DISTINCT FROM NEW.programme_id
    OR authorization_row.credential_key IS DISTINCT FROM NEW.credential_key
    OR authorization_row.credential_type IS DISTINCT FROM NEW.certificate_type
    OR authorization_row.credential_title IS DISTINCT FROM NEW.certificate_title THEN
    RAISE EXCEPTION 'Certificate details must match the QA-approved eligibility record';
  END IF;
  SELECT role, full_name INTO issuer_role, issuer_name_value
    FROM users WHERE id = NEW.issuer_user_id AND is_active = TRUE;
  IF issuer_role IS DISTINCT FROM 'admin'
    OR NEW.issuer_user_id IS DISTINCT FROM authorization_row.admin_user_id
    OR NEW.issuer_name IS DISTINCT FROM issuer_name_value
    OR NEW.issuer_title IS DISTINCT FROM 'Administrator' THEN
    RAISE EXCEPTION 'Certificate issuer must be the Administrator who authorized it';
  END IF;
  SELECT entry.item INTO credential_rule
    FROM eligibility_rule_configurations configuration,
      LATERAL jsonb_array_elements(configuration.criteria -> 'certificates') AS entry(item)
   WHERE configuration.id = authorization_row.eligibility_configuration_id
     AND configuration.status = 'APPROVED'
     AND entry.item ->> 'key' = NEW.credential_key;
  IF credential_rule IS NULL
    OR credential_rule ->> 'title' IS DISTINCT FROM NEW.certificate_title
    OR credential_rule ->> 'type' IS DISTINCT FROM NEW.certificate_type THEN
    RAISE EXCEPTION 'Certificate must match a credential in the approved programme rules';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER certificates_validate_issue
  BEFORE INSERT ON certificates
  FOR EACH ROW EXECUTE FUNCTION agri_validate_certificate_issue();
CREATE TRIGGER certificates_prevent_delete
  BEFORE DELETE OR TRUNCATE ON certificates
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_certificate_history_mutation();

CREATE FUNCTION agri_audit_certificate_workflow_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  row_data JSONB;
  old_data JSONB;
  actor_id UUID;
  actor_role_value TEXT;
  provider_id UUID;
  learner_account_id UUID;
  programme_id_value UUID;
  changed TEXT[];
  entity_identifier TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    SELECT array_agg(current_row.key ORDER BY current_row.key)
      INTO changed
      FROM jsonb_each(row_data) AS current_row(key, value)
      LEFT JOIN jsonb_each(old_data) AS previous_row(key, value) USING (key)
     WHERE current_row.value IS DISTINCT FROM previous_row.value
       AND current_row.key NOT IN ('storage_key', 'sha256', 'learner_name', 'learner_reference');
  ELSE
    SELECT array_agg(key ORDER BY key)
      INTO changed
      FROM jsonb_object_keys(row_data) AS fields(key)
     WHERE key NOT IN ('storage_key', 'sha256', 'learner_name', 'learner_reference');
  END IF;
  actor_id := COALESCE(
    NULLIF(row_data ->> 'updated_by', '')::UUID,
    NULLIF(row_data ->> 'actor_user_id', '')::UUID,
    NULLIF(row_data ->> 'admin_user_id', '')::UUID,
    NULLIF(row_data ->> 'qa_user_id', '')::UUID,
    NULLIF(row_data ->> 'approved_by', '')::UUID,
    NULLIF(row_data ->> 'rejected_by', '')::UUID,
    NULLIF(row_data ->> 'issuer_user_id', '')::UUID,
    NULLIF(row_data ->> 'revoked_by', '')::UUID,
    NULLIF(row_data ->> 'created_by', '')::UUID
  );
  SELECT role INTO actor_role_value FROM users WHERE id = actor_id;
  provider_id := NULLIF(row_data ->> 'provider_user_id', '')::UUID;
  programme_id_value := NULLIF(row_data ->> 'programme_id', '')::UUID;
  IF provider_id IS NULL AND programme_id_value IS NOT NULL THEN
    SELECT p.provider_user_id INTO provider_id FROM programmes p WHERE p.id = programme_id_value;
  END IF;
  SELECT l.learner_user_id INTO learner_account_id
    FROM learners l WHERE l.id = NULLIF(row_data ->> 'learner_id', '')::UUID;
  entity_identifier := COALESCE(row_data ->> 'id', row_data ->> 'verification_reference', 'unknown');
  INSERT INTO audit_events (
    actor_user_id, actor_role, event_type, entity_type, entity_id, changed_fields,
    provider_user_id, learner_id, learner_user_id, programme_id, source
  ) VALUES (
    actor_id, actor_role_value, TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
    entity_identifier, COALESCE(changed, ARRAY[]::TEXT[]),
    provider_id,
    NULLIF(row_data ->> 'learner_id', '')::UUID,
    learner_account_id,
    programme_id_value,
    'database-trigger'
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eligibility_configurations_audit_change
  AFTER INSERT OR UPDATE ON eligibility_rule_configurations
  FOR EACH ROW EXECUTE FUNCTION agri_audit_certificate_workflow_change();
CREATE TRIGGER certificate_eligibility_reviews_audit_change
  AFTER INSERT ON certificate_eligibility_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_audit_certificate_workflow_change();
CREATE TRIGGER certificate_authorizations_audit_change
  AFTER INSERT ON certificate_authorizations
  FOR EACH ROW EXECUTE FUNCTION agri_audit_certificate_workflow_change();
CREATE TRIGGER certificates_audit_change
  AFTER INSERT OR UPDATE ON certificates
  FOR EACH ROW EXECUTE FUNCTION agri_audit_certificate_workflow_change();
CREATE TRIGGER certificate_events_audit_change
  AFTER INSERT ON certificate_events
  FOR EACH ROW EXECUTE FUNCTION agri_audit_certificate_workflow_change();


CREATE FUNCTION agri_notify_certificate_status() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  learner_account_id UUID;
  provider_account_id UUID;
  event_name TEXT;
  notice_title TEXT;
  notice_message TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'issued';
    notice_title := 'Certificate available';
    notice_message := 'An authorized certificate is available in your learner portal.';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'REVOKED' THEN
    event_name := 'revoked';
    notice_title := 'Certificate status updated';
    notice_message := 'A certificate record was revoked. Contact your training provider for details.';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'SUPERSEDED' THEN
    event_name := 'superseded';
    notice_title := 'Certificate replaced';
    notice_message := 'A newer certificate record is available in your learner portal.';
  ELSE
    RETURN NEW;
  END IF;

  SELECT l.learner_user_id INTO learner_account_id
    FROM learners l WHERE l.id = NEW.learner_id;
  provider_account_id := NEW.provider_user_id;
  PERFORM agri_create_notification(
    learner_account_id,
    'certificate:' || NEW.id::TEXT || ':' || event_name || ':learner',
    'certificate.' || event_name, 'certification', notice_title, notice_message,
    'certificate', NEW.id::TEXT, '/learner/certificates',
    CASE WHEN event_name = 'issued' OR event_name = 'revoked' THEN 'high' ELSE 'normal' END
  );
  PERFORM agri_create_notification(
    provider_account_id,
    'certificate:' || NEW.id::TEXT || ':' || event_name || ':provider',
    'certificate.' || event_name, 'certification', notice_title,
    CASE WHEN event_name = 'issued'
      THEN 'An authorized certificate was issued for a learner in your programme.'
      ELSE 'A certificate status changed for a learner in your programme.'
    END,
    'certificate', NEW.id::TEXT, '/notifications', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER certificates_notify_recipients
  AFTER INSERT OR UPDATE OF status ON certificates
  FOR EACH ROW EXECUTE FUNCTION agri_notify_certificate_status();
