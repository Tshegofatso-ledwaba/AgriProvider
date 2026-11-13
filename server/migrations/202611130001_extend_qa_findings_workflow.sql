-- QA findings workflow extension:
-- * administrator-configured finding categories and severities (no values are seeded;
--   official scales must be supplied by an authorised administrator)
-- * optional due date set by the QA Officer (overdue is derived, never stored)
-- * QA may return an inadequate provider response (RESPONSE_SUBMITTED -> OPEN);
--   the returned response stays in the immutable event history
-- * updated_by so audit events attribute each change to the acting user

CREATE TABLE qa_finding_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('CATEGORY', 'SEVERITY')),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, kind)
);

CREATE UNIQUE INDEX qa_finding_options_kind_label_unique
  ON qa_finding_options (kind, lower(btrim(label)));

ALTER TABLE qa_findings
  ADD COLUMN category_option_id UUID,
  ADD COLUMN category_kind TEXT NOT NULL DEFAULT 'CATEGORY' CHECK (category_kind = 'CATEGORY'),
  ADD COLUMN severity_option_id UUID,
  ADD COLUMN severity_kind TEXT NOT NULL DEFAULT 'SEVERITY' CHECK (severity_kind = 'SEVERITY'),
  ADD COLUMN due_date DATE,
  ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (category_option_id, category_kind)
    REFERENCES qa_finding_options (id, kind) ON DELETE RESTRICT,
  ADD FOREIGN KEY (severity_option_id, severity_kind)
    REFERENCES qa_finding_options (id, kind) ON DELETE RESTRICT;

UPDATE qa_findings SET updated_by = qa_user_id WHERE updated_by IS NULL;
ALTER TABLE qa_findings ALTER COLUMN updated_by SET NOT NULL;

CREATE INDEX qa_findings_open_due_idx
  ON qa_findings (due_date)
  WHERE status IN ('OPEN', 'RESPONSE_SUBMITTED') AND due_date IS NOT NULL;

ALTER TABLE qa_finding_events DROP CONSTRAINT qa_finding_events_event_type_check;
ALTER TABLE qa_finding_events ADD CONSTRAINT qa_finding_events_event_type_check
  CHECK (event_type IN (
    'FINDING_CREATED', 'PROVIDER_RESPONSE_SUBMITTED', 'RESPONSE_RETURNED',
    'FINDING_VERIFIED', 'FINDING_CLOSED'
  ));

CREATE TRIGGER qa_findings_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON qa_findings
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER qa_finding_options_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON qa_finding_options
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();

CREATE FUNCTION agri_prevent_qa_finding_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QA findings are retained for accountability and cannot be deleted';
END;
$$;

CREATE TRIGGER qa_findings_no_delete
  BEFORE DELETE ON qa_findings
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_qa_finding_delete();

CREATE OR REPLACE FUNCTION agri_notify_qa_finding_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  finding_row RECORD;
  qa_recipient RECORD;
  learner_account_id UUID;
BEGIN
  SELECT finding.provider_user_id, finding.programme_id, finding.qa_user_id,
    programme.name AS programme_name, learner.learner_user_id, learner.email
    INTO finding_row
    FROM qa_findings finding
    JOIN programmes programme ON programme.id = finding.programme_id
    JOIN qa_reviews qa_review ON qa_review.id = finding.qa_review_id
    JOIN evidence_reviews assessment_review ON assessment_review.id = qa_review.evidence_review_id
    JOIN evidence_submissions submission
      ON submission.id = assessment_review.evidence_submission_id
     AND submission.version = assessment_review.submission_version
    JOIN enrolments enrolment ON enrolment.id = submission.enrolment_id
    JOIN learners learner ON learner.id = enrolment.learner_id
   WHERE finding.id = NEW.finding_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type IN ('FINDING_CREATED', 'PROVIDER_RESPONSE_SUBMITTED') THEN
    FOR qa_recipient IN
      SELECT qa_user_id
        FROM qa_programme_assignments
       WHERE programme_id = finding_row.programme_id
         AND status = 'ACTIVE' AND deactivated_at IS NULL
         AND qa_user_id <> NEW.actor_user_id
    LOOP
      PERFORM agri_create_notification(
        qa_recipient.qa_user_id,
        'qa-finding:' || NEW.id::TEXT || ':qa:' || qa_recipient.qa_user_id::TEXT,
        'qa.finding_activity', 'qa',
        CASE WHEN NEW.event_type = 'FINDING_CREATED' THEN 'QA finding recorded' ELSE 'Provider response submitted' END,
        CASE WHEN NEW.event_type = 'FINDING_CREATED'
          THEN 'A corrective action was recorded for ' || COALESCE(finding_row.programme_name, 'an assigned programme') || '.'
          ELSE 'A provider submitted a response to a QA corrective action for ' || COALESCE(finding_row.programme_name, 'an assigned programme') || '.'
        END,
        'qa_finding', NEW.finding_id::TEXT, '/qa/findings/' || NEW.finding_id::TEXT,
        CASE WHEN NEW.event_type = 'PROVIDER_RESPONSE_SUBMITTED' THEN 'high' ELSE 'normal' END
      );
    END LOOP;
  END IF;

  IF NEW.event_type = 'FINDING_CREATED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:created',
      'qa.corrective_action_required', 'qa', 'QA corrective action required',
      'A QA corrective action is required for ' || COALESCE(finding_row.programme_name, 'a programme') || '.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions/' || NEW.finding_id::TEXT, 'high'
    );
  ELSIF NEW.event_type = 'RESPONSE_RETURNED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.id::TEXT || ':provider:returned',
      'qa.corrective_action_returned', 'qa', 'Corrective action reopened',
      'QA returned your corrective-action response for ' || COALESCE(finding_row.programme_name, 'a programme') || '. Review the comments and respond again.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions/' || NEW.finding_id::TEXT, 'high'
    );
  ELSIF NEW.event_type = 'FINDING_VERIFIED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:verified',
      'qa.corrective_action_verified', 'qa', 'Corrective action verified',
      'Your response to a QA corrective action was verified.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions/' || NEW.finding_id::TEXT, 'normal'
    );
  ELSIF NEW.event_type = 'FINDING_CLOSED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:closed',
      'qa.corrective_action_closed', 'qa', 'Corrective action closed',
      'A QA corrective action was verified and closed.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions/' || NEW.finding_id::TEXT, 'normal'
    );
    learner_account_id := finding_row.learner_user_id;
    IF learner_account_id IS NULL THEN
      SELECT id INTO learner_account_id
        FROM users
       WHERE role = 'learner' AND is_active = TRUE
         AND lower(email) = lower(finding_row.email)
       LIMIT 1;
    END IF;
    PERFORM agri_create_notification(
      learner_account_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':learner:closed',
      'qa.status_updated', 'qa', 'QA status updated',
      'A QA review status was updated for one of your programme records.',
      'qa_finding', NEW.finding_id::TEXT, '/notifications', 'normal'
    );
  END IF;

  RETURN NEW;
END;
$$;
