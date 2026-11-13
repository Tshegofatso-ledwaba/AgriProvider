CREATE OR REPLACE FUNCTION agri_notify_qa_review_queue() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  qa_assignment RECORD;
  requirement_title TEXT;
BEGIN
  SELECT requirement.title INTO requirement_title
    FROM evidence_submissions submission
    JOIN programme_evidence_requirements requirement
      ON requirement.id = submission.requirement_id
     AND requirement.programme_id = submission.programme_id
     AND requirement.provider_user_id = submission.provider_user_id
   WHERE submission.id = NEW.evidence_submission_id;

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
