ALTER TABLE evidence_reviews
  ADD CONSTRAINT evidence_reviews_qa_link_unique
  UNIQUE (id, evidence_submission_id, submission_version, programme_id);

CREATE TABLE qa_programme_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  qa_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,
  UNIQUE (id, programme_id, qa_user_id),
  CHECK ((status = 'ACTIVE' AND deactivated_at IS NULL)
    OR (status = 'INACTIVE' AND deactivated_at IS NOT NULL))
);

CREATE UNIQUE INDEX qa_programme_assignments_active_pair_unique
  ON qa_programme_assignments (programme_id, qa_user_id)
  WHERE status = 'ACTIVE' AND deactivated_at IS NULL;
CREATE INDEX qa_programme_assignments_qa_active_idx
  ON qa_programme_assignments (qa_user_id, programme_id)
  WHERE status = 'ACTIVE' AND deactivated_at IS NULL;

CREATE TABLE qa_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_review_id UUID NOT NULL,
  evidence_submission_id UUID NOT NULL,
  submission_version INTEGER NOT NULL CHECK (submission_version > 0),
  programme_id UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL,
  qa_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('VERIFIED', 'FURTHER_ACTION_REQUIRED', 'NOT_VERIFIED')),
  comments TEXT NOT NULL CHECK (char_length(btrim(comments)) BETWEEN 1 AND 4000),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (evidence_review_id, evidence_submission_id, submission_version, programme_id)
    REFERENCES evidence_reviews (id, evidence_submission_id, submission_version, programme_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_submission_id, submission_version)
    REFERENCES evidence_submissions (id, version) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, programme_id, qa_user_id)
    REFERENCES qa_programme_assignments (id, programme_id, qa_user_id) ON DELETE RESTRICT,
  UNIQUE (evidence_review_id)
);

CREATE INDEX qa_reviews_programme_reviewed_idx
  ON qa_reviews (programme_id, reviewed_at DESC);
CREATE INDEX qa_reviews_user_reviewed_idx
  ON qa_reviews (qa_user_id, reviewed_at DESC);
CREATE INDEX qa_reviews_submission_version_idx
  ON qa_reviews (evidence_submission_id, submission_version DESC);

CREATE TRIGGER qa_assignments_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON qa_programme_assignments
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();
CREATE TRIGGER qa_reviews_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON qa_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_audit_domain_change();

CREATE FUNCTION agri_prevent_qa_review_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QA reviews are immutable; record a new review for a new assessment version';
END;
$$;

CREATE TRIGGER qa_reviews_immutable_row
  BEFORE UPDATE OR DELETE ON qa_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_prevent_qa_review_mutation();
CREATE TRIGGER qa_reviews_immutable_truncate
  BEFORE TRUNCATE ON qa_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION agri_prevent_qa_review_mutation();

CREATE FUNCTION agri_notify_qa_assignment() RETURNS TRIGGER
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
    NEW.qa_user_id,
    'qa-assignment:' || NEW.id::TEXT || ':' || NEW.status || ':' || NEW.updated_at::TEXT,
    'qa.assignment_changed', 'qa', 'QA programme scope updated',
    'You were ' || action_word || ' for ' || COALESCE(programme_name, 'a programme') || '.',
    'qa_assignment', NEW.id::TEXT, '/qa', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_assignments_notify_qa_officer
  AFTER INSERT OR UPDATE OF status ON qa_programme_assignments
  FOR EACH ROW EXECUTE FUNCTION agri_notify_qa_assignment();

CREATE FUNCTION agri_notify_qa_review_queue() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  qa_assignment RECORD;
  requirement_title TEXT;
BEGIN
  SELECT title INTO requirement_title
    FROM programme_evidence_requirements
   WHERE id = NEW.requirement_id;
  FOR qa_assignment IN
    SELECT qa_user_id
      FROM qa_programme_assignments
     WHERE programme_id = NEW.programme_id AND status = 'ACTIVE' AND deactivated_at IS NULL
  LOOP
    PERFORM agri_create_notification(
      qa_assignment.qa_user_id,
      'qa-queue:' || NEW.id::TEXT,
      'qa.assessment_ready', 'qa', 'Assessment ready for QA review',
      'An assessor decision for ' || COALESCE(requirement_title, 'an evidence requirement') || ' is ready for QA review.',
      'evidence_review', NEW.id::TEXT, '/qa', 'normal'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_reviews_notify_qa_officers
  AFTER INSERT ON evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_notify_qa_review_queue();

CREATE FUNCTION agri_notify_qa_review_recipients() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  provider_id UUID;
  learner_account_id UUID;
  learner_email_value TEXT;
  requirement_title TEXT;
  status_message TEXT;
BEGIN
  SELECT s.provider_user_id, l.email, l.learner_user_id, r.title
    INTO provider_id, learner_email_value, learner_account_id, requirement_title
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

  status_message := CASE NEW.decision
    WHEN 'VERIFIED' THEN 'QA verified the assessment record.'
    WHEN 'FURTHER_ACTION_REQUIRED' THEN 'QA review requires further action.'
    ELSE 'QA did not verify the assessment record.'
  END;

  PERFORM agri_create_notification(
    provider_id, 'qa-review:' || NEW.id::TEXT || ':provider',
    'qa.review_completed', 'qa', 'QA review completed',
    COALESCE(requirement_title, 'Assessment') || ': ' || status_message,
    'evidence_review', NEW.evidence_review_id::TEXT, '/enrolments', 'normal'
  );
  PERFORM agri_create_notification(
    learner_account_id, 'qa-review:' || NEW.id::TEXT || ':learner',
    'qa.review_completed', 'qa', 'QA status updated', status_message,
    'evidence_review', NEW.evidence_review_id::TEXT, '/learner', 'normal'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_reviews_notify_recipients
  AFTER INSERT ON qa_reviews
  FOR EACH ROW EXECUTE FUNCTION agri_notify_qa_review_recipients();
