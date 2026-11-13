ALTER TABLE qa_reviews
  ADD CONSTRAINT qa_reviews_finding_scope_unique
  UNIQUE (id, programme_id, assignment_id, qa_user_id);

CREATE TABLE qa_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_review_id UUID NOT NULL,
  programme_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  qa_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  finding TEXT NOT NULL CHECK (char_length(btrim(finding)) BETWEEN 1 AND 4000),
  corrective_action TEXT NOT NULL CHECK (char_length(btrim(corrective_action)) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESPONSE_SUBMITTED', 'VERIFIED', 'CLOSED')),
  provider_response TEXT CHECK (provider_response IS NULL OR char_length(btrim(provider_response)) BETWEEN 1 AND 4000),
  responded_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  responded_at TIMESTAMPTZ,
  verification_comments TEXT CHECK (verification_comments IS NULL OR char_length(btrim(verification_comments)) BETWEEN 1 AND 4000),
  verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ,
  closure_comments TEXT CHECK (closure_comments IS NULL OR char_length(btrim(closure_comments)) BETWEEN 1 AND 4000),
  closed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (qa_review_id, programme_id, assignment_id, qa_user_id)
    REFERENCES qa_reviews (id, programme_id, assignment_id, qa_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, programme_id, qa_user_id)
    REFERENCES qa_programme_assignments (id, programme_id, qa_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_user_id, programme_id)
    REFERENCES programmes (provider_user_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'OPEN' AND provider_response IS NULL AND responded_by IS NULL AND responded_at IS NULL
      AND verification_comments IS NULL AND verified_by IS NULL AND verified_at IS NULL
      AND closure_comments IS NULL AND closed_by IS NULL AND closed_at IS NULL)
    OR (status = 'RESPONSE_SUBMITTED' AND provider_response IS NOT NULL AND responded_by IS NOT NULL
      AND responded_at IS NOT NULL AND verification_comments IS NULL AND verified_by IS NULL
      AND verified_at IS NULL AND closure_comments IS NULL AND closed_by IS NULL AND closed_at IS NULL)
    OR (status = 'VERIFIED' AND provider_response IS NOT NULL AND responded_by IS NOT NULL
      AND responded_at IS NOT NULL AND verification_comments IS NOT NULL AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL AND closure_comments IS NULL AND closed_by IS NULL AND closed_at IS NULL)
    OR (status = 'CLOSED' AND provider_response IS NOT NULL AND responded_by IS NOT NULL
      AND responded_at IS NOT NULL AND verification_comments IS NOT NULL AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL AND closure_comments IS NOT NULL AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE INDEX qa_findings_provider_status_idx
  ON qa_findings (provider_user_id, status, created_at DESC);
CREATE INDEX qa_findings_programme_status_idx
  ON qa_findings (programme_id, status, created_at DESC);
CREATE INDEX qa_findings_qa_status_idx
  ON qa_findings (qa_user_id, status, created_at DESC);

CREATE TABLE qa_finding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES qa_findings(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('qa', 'provider')),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'FINDING_CREATED', 'PROVIDER_RESPONSE_SUBMITTED', 'FINDING_VERIFIED', 'FINDING_CLOSED'
  )),
  comments TEXT CHECK (comments IS NULL OR char_length(btrim(comments)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX qa_finding_events_history_idx
  ON qa_finding_events (finding_id, created_at, id);

CREATE FUNCTION agri_prevent_qa_finding_event_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QA finding events are immutable';
END;
$$;

CREATE TRIGGER qa_finding_events_immutable_row
  BEFORE UPDATE OR DELETE ON qa_finding_events
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_qa_finding_event_mutation();
CREATE TRIGGER qa_finding_events_immutable_truncate
  BEFORE TRUNCATE ON qa_finding_events
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_qa_finding_event_mutation();

CREATE FUNCTION agri_notify_qa_finding_event() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  finding_row RECORD;
  qa_recipient RECORD;
  learner_account_id UUID;
  provider_message TEXT;
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
    LOOP
      PERFORM agri_create_notification(
        qa_recipient.qa_user_id,
        'qa-finding:' || NEW.id::TEXT || ':qa:' || qa_recipient.qa_user_id::TEXT,
        'qa.finding_activity', 'qa',
        CASE WHEN NEW.event_type = 'FINDING_CREATED' THEN 'QA finding recorded' ELSE 'Provider response submitted' END,
        CASE WHEN NEW.event_type = 'FINDING_CREATED'
          THEN 'A corrective action is available for ' || COALESCE(finding_row.programme_name, 'an assigned programme') || '.'
          ELSE 'A provider submitted a response to a QA corrective action.'
        END,
        'qa_finding', NEW.finding_id::TEXT, '/qa/actions', 'normal'
      );
    END LOOP;
  END IF;

  IF NEW.event_type = 'FINDING_CREATED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:created',
      'qa.corrective_action_required', 'qa', 'QA corrective action required',
      'A QA corrective action is available for ' || COALESCE(finding_row.programme_name, 'a programme') || '.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions', 'high'
    );
  ELSIF NEW.event_type = 'FINDING_VERIFIED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:verified',
      'qa.corrective_action_verified', 'qa', 'Corrective action verified',
      'Your response to a QA corrective action was verified.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions', 'normal'
    );
  ELSIF NEW.event_type = 'FINDING_CLOSED' THEN
    PERFORM agri_create_notification(
      finding_row.provider_user_id,
      'qa-finding:' || NEW.finding_id::TEXT || ':provider:closed',
      'qa.corrective_action_closed', 'qa', 'Corrective action closed',
      'A QA corrective action was verified and closed.',
      'qa_finding', NEW.finding_id::TEXT, '/provider/qa-actions', 'normal'
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

CREATE TRIGGER qa_finding_events_notify_users
  AFTER INSERT ON qa_finding_events
  FOR EACH ROW EXECUTE FUNCTION agri_notify_qa_finding_event();
