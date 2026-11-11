ALTER TABLE programme_assessor_assignments
  ADD COLUMN updated_by UUID REFERENCES users(id);

UPDATE programme_assessor_assignments
SET updated_by = created_by
WHERE updated_by IS NULL;

ALTER TABLE programme_assessor_assignments
  ALTER COLUMN updated_by SET NOT NULL;

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{"programmes":true,"attendance":true,"evidence":true,"assessment":true,"qa":true,"certification":true,"announcements":true,"general":true}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(preferences) = 'object'),
  CHECK (preferences - ARRAY['programmes', 'attendance', 'evidence', 'assessment', 'qa', 'certification', 'announcements', 'general'] = '{}'::jsonb)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('programmes', 'attendance', 'evidence', 'assessment', 'qa', 'certification', 'announcements', 'general')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  related_entity_type TEXT,
  related_entity_id TEXT,
  action_path TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE (recipient_user_id, event_key)
);

CREATE INDEX notifications_recipient_created_idx
  ON notifications (recipient_user_id, created_at DESC, id DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure')),
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  learner_id UUID,
  learner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  programme_id UUID,
  correlation_id TEXT,
  source TEXT NOT NULL DEFAULT 'database-trigger',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC, id DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, created_at DESC);
CREATE INDEX audit_events_provider_idx ON audit_events (provider_user_id, created_at DESC);
CREATE INDEX audit_events_learner_user_idx ON audit_events (learner_user_id, created_at DESC);
CREATE INDEX audit_events_programme_idx ON audit_events (programme_id, created_at DESC);
CREATE INDEX audit_events_type_idx ON audit_events (event_type, created_at DESC);

CREATE FUNCTION agri_prevent_audit_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_immutable_row
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_audit_mutation();

CREATE TRIGGER audit_events_immutable_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_audit_mutation();

CREATE FUNCTION agri_audit_domain_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  row_data JSONB;
  actor_id UUID;
  actor_role_value TEXT;
  provider_id UUID;
  learner_record_id UUID;
  learner_account_id UUID;
  programme_record_id UUID;
  changed TEXT[];
  operation_name TEXT := lower(TG_OP);
  entity_identifier TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_row := to_jsonb(OLD);
    row_data := old_row;
  ELSE
    new_row := to_jsonb(NEW);
    row_data := new_row;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(key ORDER BY key)
      INTO changed
      FROM jsonb_object_keys(row_data) AS fields(key)
     WHERE key NOT IN ('password_hash', 'storage_key', 'sha256', 'feedback', 'phone', 'email', 'full_name', 'original_filename');
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    SELECT array_agg(current_row.key ORDER BY current_row.key)
      INTO changed
      FROM jsonb_each(new_row) AS current_row(key, value)
      LEFT JOIN jsonb_each(old_row) AS previous_row(key, value) USING (key)
     WHERE current_row.value IS DISTINCT FROM previous_row.value
       AND current_row.key NOT IN ('password_hash', 'storage_key', 'sha256', 'feedback', 'phone', 'email', 'full_name', 'original_filename');
  ELSE
    changed := ARRAY[]::TEXT[];
  END IF;

  actor_id := COALESCE(
    NULLIF(row_data ->> 'updated_by', '')::UUID,
    NULLIF(row_data ->> 'created_by', '')::UUID,
    NULLIF(row_data ->> 'marked_by', '')::UUID,
    NULLIF(row_data ->> 'submitted_by', '')::UUID,
    NULLIF(row_data ->> 'assessor_user_id', '')::UUID,
    NULLIF(row_data ->> 'qa_user_id', '')::UUID,
    NULLIF(row_data ->> 'assigned_by', '')::UUID,
    NULLIF(row_data ->> 'provider_user_id', '')::UUID
  );
  provider_id := NULLIF(row_data ->> 'provider_user_id', '')::UUID;
  programme_record_id := COALESCE(
    NULLIF(row_data ->> 'programme_id', '')::UUID,
    CASE WHEN TG_TABLE_NAME = 'programmes' THEN NULLIF(row_data ->> 'id', '')::UUID END
  );
  learner_record_id := COALESCE(
    NULLIF(row_data ->> 'learner_id', '')::UUID,
    CASE WHEN TG_TABLE_NAME = 'learners' THEN NULLIF(row_data ->> 'id', '')::UUID END
  );
  entity_identifier := COALESCE(row_data ->> 'id', row_data ->> 'session_id', row_data ->> 'enrolment_id');

  IF learner_record_id IS NULL AND NULLIF(row_data ->> 'enrolment_id', '') IS NOT NULL THEN
    SELECT e.learner_id, l.learner_user_id
      INTO learner_record_id, learner_account_id
      FROM enrolments e
      JOIN learners l ON l.id = e.learner_id
     WHERE e.id = NULLIF(row_data ->> 'enrolment_id', '')::UUID;
  ELSIF learner_record_id IS NULL AND NULLIF(row_data ->> 'evidence_submission_id', '') IS NOT NULL THEN
    SELECT e.learner_id, l.learner_user_id
      INTO learner_record_id, learner_account_id
      FROM evidence_submissions s
      JOIN enrolments e ON e.id = s.enrolment_id
      JOIN learners l ON l.id = e.learner_id
     WHERE s.id = NULLIF(row_data ->> 'evidence_submission_id', '')::UUID;
  ELSIF learner_record_id IS NOT NULL THEN
    SELECT l.learner_user_id
      INTO learner_account_id
      FROM learners l
     WHERE l.id = learner_record_id;
  END IF;

  IF TG_TABLE_NAME = 'learners' THEN
    learner_account_id := NULLIF(row_data ->> 'learner_user_id', '')::UUID;
  END IF;

  IF provider_id IS NULL AND programme_record_id IS NOT NULL THEN
    SELECT p.provider_user_id INTO provider_id
      FROM programmes p WHERE p.id = programme_record_id;
  END IF;

  SELECT u.role INTO actor_role_value FROM users u WHERE u.id = actor_id;

  INSERT INTO audit_events (
    actor_user_id, actor_role, event_type, entity_type, entity_id, changed_fields,
    provider_user_id, learner_id, learner_user_id, programme_id, correlation_id
  ) VALUES (
    actor_id,
    actor_role_value,
    TG_TABLE_NAME || '.' || operation_name,
    TG_TABLE_NAME,
    COALESCE(entity_identifier, 'unknown'),
    COALESCE(changed, ARRAY[]::TEXT[]),
    provider_id,
    learner_record_id,
    learner_account_id,
    programme_record_id,
    NULLIF(current_setting('app.correlation_id', TRUE), '')
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER programmes_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON programmes
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER learners_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON learners
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER enrolments_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON enrolments
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER training_sessions_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON training_sessions
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER attendance_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER evidence_requirements_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON programme_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER evidence_submissions_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON evidence_submissions
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER assessor_assignments_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON programme_assessor_assignments
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER evidence_reviews_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();

CREATE FUNCTION agri_create_notification(
  recipient_id UUID,
  key_value TEXT,
  type_value TEXT,
  category_value TEXT,
  title_value TEXT,
  message_value TEXT,
  entity_type_value TEXT,
  entity_id_value TEXT,
  action_path_value TEXT,
  priority_value TEXT DEFAULT 'normal'
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  category_enabled BOOLEAN;
BEGIN
  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE((p.preferences ->> category_value)::BOOLEAN, TRUE)
    INTO category_enabled
    FROM users u
    LEFT JOIN notification_preferences p ON p.user_id = u.id
   WHERE u.id = recipient_id AND u.is_active = TRUE;

  IF NOT FOUND OR NOT category_enabled THEN
    RETURN;
  END IF;

  INSERT INTO notifications (
    recipient_user_id, event_key, event_type, category, title, message,
    related_entity_type, related_entity_id, action_path, priority
  ) VALUES (
    recipient_id, key_value, type_value, category_value, title_value, message_value,
    entity_type_value, entity_id_value, action_path_value, priority_value
  ) ON CONFLICT (recipient_user_id, event_key) DO NOTHING;
END;
$$;

CREATE FUNCTION agri_notify_enrolment_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  learner_account_id UUID;
  programme_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(l.learner_user_id, linked_user.id), p.name
    INTO learner_account_id, programme_name
    FROM learners l
    JOIN programmes p ON p.id = NEW.programme_id
    LEFT JOIN users linked_user ON linked_user.role = 'learner'
      AND linked_user.is_active = TRUE AND lower(linked_user.email) = lower(l.email)
   WHERE l.id = NEW.learner_id;

  PERFORM agri_create_notification(
    learner_account_id,
    'enrolment:' || NEW.id::TEXT || ':' || NEW.status || ':' || NEW.updated_at::TEXT,
    'enrolment.status_changed', 'programmes', 'Programme enrolment updated',
    'Your enrolment in ' || COALESCE(programme_name, 'a programme') || ' is ' || NEW.status || '.',
    'enrolment', NEW.id::TEXT, '/learner/programmes', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER enrolments_notify_learner
  AFTER INSERT OR UPDATE OF status ON enrolments
  FOR EACH ROW EXECUTE FUNCTION agri_notify_enrolment_change();

CREATE FUNCTION agri_notify_attendance_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  learner_account_id UUID;
  session_title TEXT;
BEGIN
  SELECT COALESCE(l.learner_user_id, linked_user.id), s.title
    INTO learner_account_id, session_title
    FROM enrolments e
    JOIN learners l ON l.id = e.learner_id
    JOIN training_sessions s ON s.id = NEW.session_id
    LEFT JOIN users linked_user ON linked_user.role = 'learner'
      AND linked_user.is_active = TRUE AND lower(linked_user.email) = lower(l.email)
   WHERE e.id = NEW.enrolment_id;

  PERFORM agri_create_notification(
    learner_account_id,
    'attendance:' || NEW.id::TEXT || ':' || NEW.updated_at::TEXT,
    'attendance.recorded', 'attendance', 'Attendance updated',
    'Attendance for ' || COALESCE(session_title, 'a training session') || ' was recorded as ' || NEW.status || '.',
    'session', NEW.session_id::TEXT, '/learner/attendance', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_notify_learner
  AFTER INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION agri_notify_attendance_change();

CREATE FUNCTION agri_notify_requirement_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  linked_learner RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.title IS NOT DISTINCT FROM OLD.title
    AND NEW.guidance IS NOT DISTINCT FROM OLD.guidance THEN
    RETURN NEW;
  END IF;

  FOR linked_learner IN
    SELECT DISTINCT COALESCE(l.learner_user_id, linked_user.id) AS user_id
      FROM enrolments e
      JOIN learners l ON l.id = e.learner_id
      LEFT JOIN users linked_user ON linked_user.role = 'learner'
        AND linked_user.is_active = TRUE AND lower(linked_user.email) = lower(l.email)
     WHERE e.programme_id = NEW.programme_id AND e.status = 'active'
  LOOP
    PERFORM agri_create_notification(
      linked_learner.user_id,
      'requirement:' || NEW.id::TEXT || ':' || NEW.updated_at::TEXT,
      'evidence_requirement.updated', 'evidence', 'Evidence requirement updated',
      'A programme evidence requirement is available: ' || NEW.title || '.',
      'evidence_requirement', NEW.id::TEXT, '/learner/evidence', 'normal'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER requirements_notify_learners
  AFTER INSERT OR UPDATE ON programme_evidence_requirements
  FOR EACH ROW EXECUTE FUNCTION agri_notify_requirement_change();

CREATE FUNCTION agri_notify_submission_assessors() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  assigned_assessor RECORD;
  requirement_title TEXT;
BEGIN
  SELECT title INTO requirement_title
    FROM programme_evidence_requirements
   WHERE id = NEW.requirement_id;

  FOR assigned_assessor IN
    SELECT assessor_user_id
      FROM programme_assessor_assignments
     WHERE programme_id = NEW.programme_id AND status = 'ACTIVE' AND deactivated_at IS NULL
  LOOP
    PERFORM agri_create_notification(
      assigned_assessor.assessor_user_id,
      'submission:' || NEW.id::TEXT,
      'evidence.submitted', 'assessment', 'Evidence awaiting assessment',
      'A new evidence version was submitted for ' || COALESCE(requirement_title, 'a requirement') || '.',
      'evidence_submission', NEW.id::TEXT,
      '/assessor/submissions/' || NEW.id::TEXT, 'high'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_submissions_notify_assessors
  AFTER INSERT ON evidence_submissions
  FOR EACH ROW EXECUTE FUNCTION agri_notify_submission_assessors();

CREATE FUNCTION agri_notify_review_recipients() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  provider_id UUID;
  learner_account_id UUID;
  requirement_title TEXT;
  decision_label TEXT;
  submitted_id UUID;
  learner_email_value TEXT;
BEGIN
  SELECT s.provider_user_id, s.enrolment_id, s.requirement_id
    INTO provider_id, submitted_id, learner_account_id
    FROM evidence_submissions s WHERE s.id = NEW.evidence_submission_id;
  IF submitted_id IS NOT NULL THEN
    SELECT e.learner_id, l.email, l.learner_user_id, r.title
      INTO submitted_id, learner_email_value, learner_account_id, requirement_title
      FROM evidence_submissions s
      JOIN enrolments e ON e.id = s.enrolment_id
      JOIN learners l ON l.id = e.learner_id
      JOIN programme_evidence_requirements r ON r.id = s.requirement_id
     WHERE s.id = NEW.evidence_submission_id;
    IF learner_account_id IS NULL THEN
      SELECT id INTO learner_account_id FROM users
       WHERE role = 'learner' AND is_active = TRUE AND lower(email) = lower(learner_email_value)
       LIMIT 1;
    END IF;
  END IF;

  decision_label := CASE NEW.decision
    WHEN 'APPROVED' THEN 'approved'
    ELSE 'requires corrections'
  END;

  PERFORM agri_create_notification(
    provider_id,
    'review:' || NEW.id::TEXT || ':provider',
    'assessment.reviewed', 'assessment', 'Assessor review completed',
    COALESCE(requirement_title, 'Evidence') || ' ' || decision_label || '.',
    'evidence_submission', NEW.evidence_submission_id::TEXT,
    '/enrolments', 'high'
  );
  PERFORM agri_create_notification(
    learner_account_id,
    'review:' || NEW.id::TEXT || ':learner',
    'assessment.reviewed', 'assessment', 'Evidence review updated',
    COALESCE(requirement_title, 'Evidence') || ' ' || decision_label || '.',
    'evidence_submission', NEW.evidence_submission_id::TEXT,
    '/learner/evidence', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_reviews_notify_recipients
  AFTER INSERT ON evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_notify_review_recipients();

CREATE FUNCTION agri_notify_assessor_assignment() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  programme_name TEXT;
  action_word TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT name INTO programme_name FROM programmes WHERE id = NEW.programme_id;
  action_word := CASE WHEN NEW.status = 'ACTIVE' THEN 'assigned' ELSE 'deactivated' END;
  PERFORM agri_create_notification(
    NEW.assessor_user_id,
    'assignment:' || NEW.id::TEXT || ':' || NEW.status || ':' || NEW.updated_at::TEXT,
    'assessor.assignment_changed', 'assessment', 'Programme assignment updated',
    'You were ' || action_word || ' for ' || COALESCE(programme_name, 'a programme') || '.',
    'assessor_assignment', NEW.id::TEXT, '/assessor', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessor_assignments_notify_assessor
  AFTER INSERT OR UPDATE OF status ON programme_assessor_assignments
  FOR EACH ROW EXECUTE FUNCTION agri_notify_assessor_assignment();

CREATE TABLE eligibility_rule_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  criteria JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'INACTIVE')),
  effective_from DATE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  approval_authority TEXT,
  rejected_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  UNIQUE (programme_id, version),
  CHECK (jsonb_typeof(criteria) = 'object'),
  CHECK ((status <> 'APPROVED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_authority IS NOT NULL)),
  CHECK ((status <> 'PENDING_APPROVAL') OR submitted_at IS NOT NULL),
  CHECK ((status <> 'REJECTED') OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_reason IS NOT NULL))
);

CREATE INDEX eligibility_rule_configurations_programme_status_idx
  ON eligibility_rule_configurations (programme_id, status, version DESC);

CREATE FUNCTION agri_protect_eligibility_configuration_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'INACTIVE') THEN
    RAISE EXCEPTION 'Approved eligibility configurations are immutable; create a new version';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Eligibility approval authority has not been configured';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eligibility_configurations_versioned
  BEFORE UPDATE OR DELETE ON eligibility_rule_configurations
  FOR EACH ROW EXECUTE FUNCTION agri_protect_eligibility_configuration_history();
