-- Training timetable and assessment scheduling.
-- * training sessions gain an optional end time and venue
-- * enrolled learners are notified when a session is scheduled, changed, or cancelled
-- * assessment schedules link a programme (and optionally one enrolment) to an
--   actively assigned assessor; changes are kept in an append-only event history.
--   Assessment outcomes remain the immutable, version-bound evidence_reviews rows.

ALTER TABLE training_sessions
  ADD COLUMN ends_at TIMESTAMPTZ,
  ADD COLUMN venue TEXT CHECK (venue IS NULL OR char_length(btrim(venue)) BETWEEN 1 AND 160),
  ADD CONSTRAINT training_sessions_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at);

CREATE INDEX training_sessions_programme_start_idx
  ON training_sessions (programme_id, starts_at)
  WHERE archived_at IS NULL;

CREATE FUNCTION agri_notify_training_session_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  linked_learner RECORD;
  event_name TEXT;
  title_text TEXT;
  message_text TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'session.scheduled';
    title_text := 'New training session';
    message_text := NEW.title || ' is scheduled for ' || to_char(NEW.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI') || ' (SAST).';
  ELSIF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    event_name := 'session.cancelled';
    title_text := 'Training session cancelled';
    message_text := NEW.title || ' on ' || to_char(OLD.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI') || ' (SAST) was cancelled.';
  ELSIF NEW.archived_at IS NULL AND (
      NEW.starts_at IS DISTINCT FROM OLD.starts_at
      OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
      OR NEW.venue IS DISTINCT FROM OLD.venue
      OR NEW.title IS DISTINCT FROM OLD.title) THEN
    event_name := 'session.changed';
    title_text := 'Training session updated';
    message_text := NEW.title || ' now starts ' || to_char(NEW.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI') || ' (SAST)'
      || COALESCE(' at ' || NEW.venue, '') || '.';
  ELSE
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
      'session:' || NEW.id::TEXT || ':' || event_name || ':' || NEW.updated_at::TEXT,
      event_name, 'attendance', title_text, message_text,
      'session', NEW.id::TEXT, '/learner/calendar', 'normal'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_sessions_notify_learners
  AFTER INSERT OR UPDATE ON training_sessions
  FOR EACH ROW EXECUTE FUNCTION agri_notify_training_session_change();

CREATE TABLE assessment_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  programme_id UUID NOT NULL,
  enrolment_id UUID,
  assessor_assignment_id UUID NOT NULL,
  assessor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location TEXT CHECK (location IS NULL OR char_length(btrim(location)) BETWEEN 1 AND 160),
  notes TEXT CHECK (notes IS NULL OR char_length(btrim(notes)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((status = 'SCHEDULED' AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND completed_at IS NULL)),
  FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes (provider_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_user_id, programme_id, enrolment_id)
    REFERENCES enrolments (provider_user_id, programme_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (assessor_assignment_id, programme_id, assessor_user_id)
    REFERENCES programme_assessor_assignments (id, programme_id, assessor_user_id) ON DELETE RESTRICT
);

CREATE INDEX assessment_schedules_provider_start_idx
  ON assessment_schedules (provider_user_id, starts_at);
CREATE INDEX assessment_schedules_assessor_start_idx
  ON assessment_schedules (assessor_user_id, starts_at);
CREATE INDEX assessment_schedules_programme_start_idx
  ON assessment_schedules (programme_id, starts_at);
CREATE INDEX assessment_schedules_enrolment_idx
  ON assessment_schedules (enrolment_id)
  WHERE enrolment_id IS NOT NULL;

CREATE TRIGGER assessment_schedules_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON assessment_schedules
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();

CREATE FUNCTION agri_prevent_assessment_schedule_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment schedules are retained; cancel them instead of deleting';
END;
$$;

CREATE TRIGGER assessment_schedules_no_delete
  BEFORE DELETE ON assessment_schedules
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_assessment_schedule_delete();

CREATE TABLE assessment_schedule_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES assessment_schedules(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('provider', 'assessor')),
  event_type TEXT NOT NULL CHECK (event_type IN ('SCHEDULED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED')),
  previous_values JSONB,
  new_values JSONB,
  comments TEXT CHECK (comments IS NULL OR char_length(btrim(comments)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX assessment_schedule_events_history_idx
  ON assessment_schedule_events (schedule_id, created_at, id);

CREATE FUNCTION agri_prevent_assessment_schedule_event_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment schedule events are immutable';
END;
$$;

CREATE TRIGGER assessment_schedule_events_immutable_row
  BEFORE UPDATE OR DELETE ON assessment_schedule_events
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_assessment_schedule_event_mutation();
CREATE TRIGGER assessment_schedule_events_immutable_truncate
  BEFORE TRUNCATE ON assessment_schedule_events
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_assessment_schedule_event_mutation();

CREATE FUNCTION agri_notify_assessment_schedule_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  schedule_row RECORD;
  recipient RECORD;
  when_text TEXT;
  title_text TEXT;
  message_text TEXT;
BEGIN
  SELECT s.*, p.name AS programme_name
    INTO schedule_row
    FROM assessment_schedules s
    JOIN programmes p ON p.id = s.programme_id
   WHERE s.id = NEW.schedule_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  when_text := to_char(schedule_row.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI') || ' (SAST)';

  IF NEW.event_type = 'COMPLETED' THEN
    PERFORM agri_create_notification(
      schedule_row.provider_user_id,
      'assessment-schedule:' || NEW.id::TEXT || ':provider',
      'assessment.completed', 'assessment', 'Assessment completed',
      schedule_row.title || ' for ' || schedule_row.programme_name || ' was marked completed by the assessor.',
      'assessment_schedule', schedule_row.id::TEXT, '/assessments/' || schedule_row.id::TEXT, 'normal'
    );
    RETURN NEW;
  END IF;

  title_text := CASE NEW.event_type
    WHEN 'SCHEDULED' THEN 'Assessment scheduled'
    WHEN 'RESCHEDULED' THEN 'Assessment rescheduled'
    ELSE 'Assessment cancelled'
  END;
  message_text := schedule_row.title || ' (' || schedule_row.programme_name || ') '
    || CASE NEW.event_type
         WHEN 'CANCELLED' THEN 'on ' || when_text || ' was cancelled.'
         ELSE 'is scheduled for ' || when_text || COALESCE(' at ' || schedule_row.location, '') || '.'
       END;

  PERFORM agri_create_notification(
    schedule_row.assessor_user_id,
    'assessment-schedule:' || NEW.id::TEXT || ':assessor',
    'assessment.schedule_changed', 'assessment', title_text, message_text,
    'assessment_schedule', schedule_row.id::TEXT, '/assessor/assessments/' || schedule_row.id::TEXT,
    CASE WHEN NEW.event_type = 'SCHEDULED' THEN 'high' ELSE 'normal' END
  );

  FOR recipient IN
    SELECT DISTINCT COALESCE(l.learner_user_id, linked_user.id) AS user_id
      FROM enrolments e
      JOIN learners l ON l.id = e.learner_id
      LEFT JOIN users linked_user ON linked_user.role = 'learner'
        AND linked_user.is_active = TRUE AND lower(linked_user.email) = lower(l.email)
     WHERE e.programme_id = schedule_row.programme_id AND e.status = 'active'
       AND (schedule_row.enrolment_id IS NULL OR e.id = schedule_row.enrolment_id)
  LOOP
    PERFORM agri_create_notification(
      recipient.user_id,
      'assessment-schedule:' || NEW.id::TEXT || ':learner',
      'assessment.schedule_changed', 'assessment', title_text, message_text,
      'assessment_schedule', schedule_row.id::TEXT, '/learner/calendar', 'normal'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assessment_schedule_events_notify
  AFTER INSERT ON assessment_schedule_events
  FOR EACH ROW EXECUTE FUNCTION agri_notify_assessment_schedule_event();
