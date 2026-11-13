import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  DashboardHero,
  EmptyNotice,
  ErrorNotice,
  LoadingNotice,
  Page,
  PageTitle,
  routeHref,
  SummaryCard,
} from '@/components/programme-ui';
import { useAuth } from '@/providers/auth-provider';
import {
  getLearnerDashboard,
  LearnerDashboard,
  LearnerEvidenceRequirement,
} from '@/services/learner-dashboard';
import { apiErrorText } from '@/services/api';

type LearnerSection = 'home' | 'programmes' | 'attendance' | 'evidence';

export default function LearnerWorkspace({ section }: { section: LearnerSection }) {
  const { user, credential } = useAuth();
  const [dashboard, setDashboard] = useState<LearnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!credential) {
      setLoading(false);
      setError('Your learner session is unavailable. Please sign in again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      setDashboard(await getLearnerDashboard(credential));
    } catch (requestError) {
      setDashboard(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }, [credential]);

  useFocusEffect(useCallback(() => {
    void loadDashboard();
  }, [loadDashboard]));

  const firstName = dashboard?.learner.fullName.trim().split(/\s+/)[0]
    || user?.fullName.trim().split(/\s+/)[0]
    || 'Learner';

  return (
    <Page onRefresh={() => void loadDashboard()} refreshing={loading}>
      {section === 'home' ? (
        <View className="gap-2">
          <DashboardHero
            eyebrow="LEARNER PORTAL"
            title={`Welcome back, ${firstName}`}
            subtitle="Your recorded training, attendance and evidence in one place."
            symbol={{ ios: 'graduationcap.fill', android: 'school', web: 'school' }}
          />
          {dashboard?.learner.learnerReference ? (
            <Text className="px-1 text-xs font-bold text-muted">
              Learner reference · {dashboard.learner.learnerReference}
            </Text>
          ) : null}
        </View>
      ) : null}

      {section !== 'home' ? (
        <PageTitle title={sectionTitle(section)} subtitle={sectionSubtitle(section)} />
      ) : null}

      {loading ? <LoadingNotice label="Loading your learner workspace..." /> : null}
      {!loading && error ? <ErrorNotice message={error} onRetry={() => void loadDashboard()} /> : null}

      {!loading && !error && dashboard ? (
        section === 'home'
          ? <LearnerHome dashboard={dashboard} />
          : section === 'programmes'
            ? <ProgrammesSection dashboard={dashboard} />
            : section === 'attendance'
              ? <AttendanceSection dashboard={dashboard} />
              : <EvidenceSection dashboard={dashboard} />
      ) : null}
    </Page>
  );
}

function LearnerHome({ dashboard }: { dashboard: LearnerDashboard }) {
  const { programmes, attendance, evidenceSummary } = dashboard;
  const activeProgrammes = programmes.filter((programme) => programme.status === 'active');
  const actions = dashboard.evidence.filter((item) =>
    item.enrolmentStatus === 'active'
    && (item.status === 'NOT_SUBMITTED' || item.status === 'CORRECTION_REQUIRED'));
  const attendanceRate = attendance.summary.recorded > 0
    ? Math.round((attendance.summary.present / attendance.summary.recorded) * 100)
    : null;

  return (
    <>
      <View className="gap-3">
        <SectionHeading title="My programme" action="All programmes" href="/learner/programmes" />
        {programmes.length ? (
          <View className="gap-3">
            {programmes.slice(0, 2).map((programme) => (
              <View key={programme.enrolmentId} className="gap-2 rounded-2xl border border-border bg-white p-5 shadow-sm shadow-primary/5">
                <View className="flex-row items-start justify-between gap-3">
                  <Text className="flex-1 text-base font-extrabold text-ink">{programme.name}</Text>
                  <StatusBadge status={programme.status === 'active' ? 'Active' : 'Withdrawn'} />
                </View>
                <Text className="text-sm text-muted">Training provider · {programme.providerName}</Text>
                {programme.description ? (
                  <Text className="text-sm leading-5 text-muted">{programme.description}</Text>
                ) : null}
                <Text className="text-xs text-muted">Enrolled {formatDate(programme.enrolledAt)}</Text>
                <Link href={routeHref('/learner/programmes')} asChild>
                  <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center self-start rounded-xl bg-primary px-4 py-2 active:opacity-80">
                    <Text className="text-sm font-bold text-white">View programme</Text>
                  </Pressable>
                </Link>
              </View>
            ))}
          </View>
        ) : (
          <EmptyNotice
            title="No programme linked yet"
            message="Your training provider can link your learner record to a programme."
          />
        )}
      </View>

      <ProgressSummary dashboard={dashboard} />

      <View className="gap-3 rounded-2xl border border-primary/20 bg-white p-4 shadow-sm shadow-primary/5">
        <View className="gap-1">
          <Text className="text-base font-extrabold text-ink">Certificates</Text>
          <Text className="text-sm leading-5 text-muted">Authorized certificates and prior certificate history appear after QA review and Administrator approval.</Text>
        </View>
        <Link href={routeHref('/learner/certificates')} asChild>
          <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center self-start rounded-xl bg-primary px-4 py-3 active:opacity-80">
            <Text className="text-sm font-bold text-white">View certificate history</Text>
          </Pressable>
        </Link>
      </View>

      <View className="gap-3">
        <Text className="text-base font-extrabold text-ink">At a glance</Text>
        <View className="flex-row flex-wrap gap-3">
          <SummaryCard
            symbol={{ ios: 'calendar.badge.checkmark', android: 'event_available', web: 'event_available' }}
            label="Attendance"
            value={attendanceRate === null ? '—' : `${attendanceRate}%`}
            detail={attendance.summary.recorded
              ? `${attendance.summary.present} of ${attendance.summary.recorded} recorded sessions`
              : 'No sessions recorded'}
            tone="forest"
          />
          <SummaryCard
            symbol={{ ios: 'doc.text', android: 'description', web: 'description' }}
            label="Evidence"
            value={`${evidenceSummary.approved}/${evidenceSummary.total}`}
            detail={evidenceSummary.total
              ? `${evidenceSummary.approved} approved · ${evidenceSummary.notSubmitted} not submitted`
              : 'no requirements configured'}
            tone="plain"
          />
          <SummaryCard
            symbol={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
            label="Assessment"
            value={String(evidenceSummary.awaitingAssessment)}
            detail={`${evidenceSummary.approved} approved · ${evidenceSummary.correctionsRequired} corrections`}
            tone={evidenceSummary.correctionsRequired ? 'amber' : 'plain'}
          />
          <SummaryCard
            symbol={{ ios: 'graduationcap', android: 'school', web: 'school' }}
            label="Programme"
            value={String(activeProgrammes.length)}
            detail={`${activeProgrammes.length === 1 ? 'active enrolment' : 'active enrolments'} · completion not tracked`}
            tone="sage"
          />
        </View>
      </View>

      <View className="gap-3">
        <SectionHeading title="Action required" action="View evidence" href="/learner/evidence" />
        {actions.length ? (
          <View className="gap-3">
            {actions.slice(0, 4).map((item) => <ActionCard key={`${item.enrolmentId}:${item.requirementId}`} item={item} />)}
            {actions.length > 4 ? (
              <Text className="text-xs text-muted">Showing the first four items. Open Evidence to review the full checklist.</Text>
            ) : null}
          </View>
        ) : evidenceSummary.total === 0 ? (
          <EmptyNotice
            title="No evidence checklist yet"
            message="Your provider has not configured evidence requirements for your linked programmes."
          />
        ) : (
          <EmptyNotice
            title="You're all caught up"
            message="There are no unsubmitted or correction-requested evidence items on your checklist."
          />
        )}
      </View>

      <View className="gap-3">
        <SectionHeading title="Evidence checklist" action="View all" href="/learner/evidence" />
        {dashboard.evidence.length ? (
          <View>
            {dashboard.evidence.slice(0, 3).map((item) => (
              <EvidenceCard key={`${item.enrolmentId}:${item.requirementId}`} item={item} compact />
            ))}
          </View>
        ) : (
          <EmptyNotice title="No checklist items" message="Evidence requirements will appear here when configured by your provider." />
        )}
      </View>

      <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
        <SectionHeading title="My attendance" action="View attendance" href="/learner/attendance" />
        <Text className="text-sm text-muted">
          {attendanceRate === null
            ? 'Attendance will appear after your provider records sessions.'
            : `${attendanceRate}% attendance across ${attendance.summary.recorded} recorded sessions.`}
        </Text>
        {attendance.recent.slice(0, 3).map((record) => (
          <AttendanceRow key={record.sessionId} record={record} />
        ))}
        {!attendance.recent.length ? (
          <Text className="text-sm text-muted">No attendance records are available yet.</Text>
        ) : null}
      </View>

      <View className="gap-3">
        <SectionHeading title="Recent activity" />
        {dashboard.recentActivity.length ? (
          <View className="gap-2">
            {dashboard.recentActivity.slice(0, 5).map((activity, index) => (
              <View key={`${activity.type}-${activity.occurredAt}-${index}`} className="flex-row gap-3 rounded-2xl border border-border bg-white p-3">
                <View className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                <View className="flex-1 gap-1">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-sm font-bold text-ink">{activity.description}</Text>
                    <StatusBadge status={activityStatusLabel(activity.status)} />
                  </View>
                  <Text className="text-xs text-muted">{activity.detail} · {activity.programmeName}</Text>
                  <Text className="text-xs text-muted">{formatDateTime(activity.occurredAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyNotice title="No recent activity" message="Attendance and evidence updates will appear here when recorded." />
        )}
      </View>

      <View className="gap-2 rounded-[24px] border border-border bg-white p-4">
        <Text className="text-base font-extrabold text-ink">Announcements</Text>
        <Text className="text-sm leading-5 text-muted">
          Announcements and notifications are not yet available in the learner portal.
        </Text>
      </View>
    </>
  );
}

function ProgressSummary({ dashboard }: { dashboard: LearnerDashboard }) {
  const { programmes, attendance, evidenceSummary } = dashboard;
  const hasEnrolment = programmes.some((programme) => programme.status === 'active');
  const hasTrainingRecords = attendance.summary.recorded > 0;
  const submittedCount = evidenceSummary.total - evidenceSummary.notSubmitted;
  const hasAnyAssessmentActivity = evidenceSummary.approved > 0
    || evidenceSummary.awaitingAssessment > 0
    || evidenceSummary.correctionsRequired > 0;
  const allEvidenceAssessed = evidenceSummary.total > 0
    && evidenceSummary.notSubmitted === 0
    && evidenceSummary.awaitingAssessment === 0
    && evidenceSummary.correctionsRequired === 0;
  const steps = [
    { title: 'Enrolled', detail: hasEnrolment ? 'Active enrolment recorded' : 'No active enrolment', state: hasEnrolment ? 'complete' : 'pending' },
    { title: 'Training in progress', detail: hasTrainingRecords ? `${attendance.summary.recorded} attendance records` : 'No attendance records yet', state: hasTrainingRecords ? 'inProgress' : 'pending' },
    { title: 'Evidence collection', detail: evidenceSummary.total ? `${evidenceSummary.total} requirements configured` : 'No checklist configured', state: evidenceSummary.total ? 'inProgress' : 'pending' },
    { title: 'Evidence submitted', detail: evidenceSummary.total
      ? `${submittedCount} of ${evidenceSummary.total} requirements submitted`
      : 'No evidence requirements configured', state: evidenceSummary.total === 0
        ? 'pending'
        : evidenceSummary.notSubmitted === 0 ? 'complete' : submittedCount > 0 ? 'inProgress' : 'pending' },
    { title: 'Assessment', detail: hasAnyAssessmentActivity
      ? `${evidenceSummary.approved} approved · ${evidenceSummary.awaitingAssessment} awaiting · ${evidenceSummary.correctionsRequired} corrections`
      : evidenceSummary.awaitingAssessment
        ? `${evidenceSummary.awaitingAssessment} awaiting assessment`
        : 'No assessment activity recorded', state: allEvidenceAssessed
          ? 'complete'
          : hasAnyAssessmentActivity ? 'inProgress' : 'pending' },
    { title: 'QA verification', detail: 'Not recorded in current learner data', state: 'unavailable' },
    { title: 'Programme completion', detail: 'Official completion is not recorded', state: 'unavailable' },
  ];

  return (
    <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
      <Text className="text-base font-extrabold text-ink">My progress</Text>
      <Text className="text-sm leading-5 text-muted">
        Progress is shown from recorded activity; no percentage or completion score is calculated.
      </Text>
      <View className="gap-3">
        {steps.map((step) => (
          <View key={step.title} className="flex-row items-start gap-3">
            <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full ${step.state === 'complete' ? 'bg-emerald-100' : step.state === 'inProgress' ? 'bg-amber-50' : 'bg-slate-100'}`}>
              <Text className={`text-xs font-extrabold ${step.state === 'complete' ? 'text-emerald-800' : step.state === 'inProgress' ? 'text-amber-800' : 'text-slate-500'}`}>
                {step.state === 'complete' ? '✓' : step.state === 'inProgress' ? '•' : step.state === 'unavailable' ? '—' : '·'}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm font-bold text-ink">{step.title}</Text>
              <Text className="text-xs leading-4 text-muted">{step.detail}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function ProgrammesSection({ dashboard }: { dashboard: LearnerDashboard }) {
  return (
    <View className="gap-3">
      {dashboard.programmes.length ? dashboard.programmes.map((programme) => (
        <View key={programme.enrolmentId} className="gap-3 rounded-[24px] border border-border bg-white p-4 shadow-sm shadow-black/5">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-lg font-extrabold text-ink">{programme.name}</Text>
            <StatusBadge status={programme.status === 'active' ? 'Active' : 'Withdrawn'} />
          </View>
          <InfoRow label="Provider" value={programme.providerName} />
          <InfoRow label="Enrolled" value={formatDate(programme.enrolledAt)} />
          <InfoRow label="Status" value={programme.status === 'active' ? 'Active enrolment' : 'Withdrawn enrolment'} />
          {programme.description ? (
            <View className="gap-1">
              <Text className="text-xs font-bold text-muted">Programme description</Text>
              <Text className="text-sm leading-5 text-ink">{programme.description}</Text>
            </View>
          ) : null}
          <Text className="text-xs leading-4 text-muted">
            Programme duration, training milestones, and official completion status are not recorded in this workspace.
          </Text>
          <Link href={routeHref('/learner/evidence')} asChild>
            <Pressable accessibilityRole="button" className="min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-3 active:opacity-80">
              <Text className="text-sm font-bold text-white">View evidence checklist</Text>
            </Pressable>
          </Link>
        </View>
      )) : (
        <EmptyNotice title="No programmes linked" message="Your provider can link your learner record to a programme." />
      )}
    </View>
  );
}

function AttendanceSection({ dashboard }: { dashboard: LearnerDashboard }) {
  const { summary, recent } = dashboard.attendance;
  const percentage = summary.recorded ? Math.round((summary.present / summary.recorded) * 100) : null;
  return (
    <>
      <View className="flex-row flex-wrap gap-3">
        <SummaryCard label="Attendance" value={percentage === null ? '—' : `${percentage}%`} detail="of recorded sessions" tone="forest" />
        <SummaryCard label="Present" value={String(summary.present)} detail="sessions attended" tone="sage" />
        <SummaryCard label="Absent" value={String(summary.absent)} detail="recorded as absent" tone="amber" />
        <SummaryCard label="Recorded" value={String(summary.recorded)} detail={`${summary.excused} excused`} tone="plain" />
      </View>
      <View className="gap-3">
        <Text className="text-base font-extrabold text-ink">Recent attendance</Text>
        {recent.length ? (
          <View className="gap-2">
            {recent.map((record) => <AttendanceRow key={record.sessionId} record={record} />)}
            <Text className="text-xs text-muted">Showing the 10 most recent attendance records. Attendance is view-only.</Text>
          </View>
        ) : (
          <EmptyNotice title="No attendance records yet" message="Your provider will record attendance after training sessions." />
        )}
      </View>
    </>
  );
}

function EvidenceSection({ dashboard }: { dashboard: LearnerDashboard }) {
  return (
    <View className="gap-3">
      {dashboard.evidence.length ? dashboard.evidence.map((item) => (
        <EvidenceCard key={`${item.enrolmentId}:${item.requirementId}`} item={item} />
      )) : (
        <EmptyNotice
          title="No evidence requirements yet"
          message="Your provider has not configured evidence checklist items for your programme."
        />
      )}
      <Text className="text-xs leading-4 text-muted">
        Evidence submissions and assessor feedback are read-only here. Learner uploads are not enabled for this account.
      </Text>
    </View>
  );
}

function EvidenceCard({ item, compact = false }: { item: LearnerEvidenceRequirement; compact?: boolean }) {
  const latest = item.submissions[0];
  return (
    <View className="gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm shadow-black/5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-extrabold text-ink">{item.title}</Text>
          <Text className="text-xs text-muted">{item.programmeName}</Text>
        </View>
        <StatusBadge status={evidenceStatusLabel(item.status)} />
      </View>
      {item.guidance ? <Text className="text-sm leading-5 text-muted">{item.guidance}</Text> : null}
      {latest ? (
        <View className="gap-2 rounded-xl bg-surface p-3">
          <InfoRow label="Submission" value={`${latest.filename} · version ${latest.version}`} />
          <InfoRow label="Submitted" value={formatDate(latest.submittedAt)} />
          <InfoRow label="Assessment" value={assessmentLabel(latest)} />
          {latest.review?.feedback ? (
            <View className="gap-1 border-t border-border pt-2">
              <Text className="text-xs font-bold text-muted">Assessor feedback</Text>
              <Text className="text-sm leading-5 text-ink">{latest.review.feedback}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text className="text-sm text-muted">No submission has been recorded for this requirement.</Text>
      )}
      {!compact && item.submissions.length > 1 ? (
        <View className="gap-2 border-t border-border pt-2">
          <Text className="text-xs font-extrabold tracking-wide text-muted">SUBMISSION HISTORY</Text>
          {item.submissions.map((submission) => (
            <View key={submission.id} className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-xs text-muted">
                v{submission.version} · {formatDate(submission.submittedAt)}
              </Text>
              <Text className="text-xs font-bold text-ink">{evidenceStatusLabel(submission.status)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {item.status === 'CORRECTION_REQUIRED' ? (
        <Text className="text-xs leading-4 text-amber-900">
          Your provider manages evidence uploads. Contact them to arrange a corrected submission.
        </Text>
      ) : null}
    </View>
  );
}

function ActionCard({ item }: { item: LearnerEvidenceRequirement }) {
  const correction = item.status === 'CORRECTION_REQUIRED';
  const feedback = item.submissions[0]?.review?.feedback;
  return (
    <View className={`gap-2 rounded-2xl border p-4 ${correction ? 'border-amber-200 bg-amber-50' : 'border-border bg-white'}`}>
      <Text className="text-sm font-extrabold text-ink">{correction ? 'Corrections requested' : 'Evidence not submitted'}</Text>
      <Text className="text-sm leading-5 text-muted">
        {correction
          ? `${item.title} needs attention.${feedback ? ` Feedback: ${feedback}` : ''}`
          : `${item.title} has no submission recorded for ${item.programmeName}.`}
      </Text>
      <Text className="text-xs leading-4 text-muted">
        {correction
          ? 'Review the assessor feedback and contact your provider to arrange an updated submission.'
          : 'Contact your provider to confirm how this requirement should be submitted.'}
      </Text>
      <Link href={routeHref('/learner/evidence')} asChild>
        <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center self-start rounded-xl bg-primary px-4 py-2 active:opacity-80">
          <Text className="text-sm font-bold text-white">{correction ? 'View feedback' : 'View requirement'}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

function AttendanceRow({ record }: { record: LearnerDashboard['attendance']['recent'][number] }) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-3">
      <View className="flex-1 gap-1">
        <Text className="text-sm font-bold text-ink">{record.title}</Text>
        <Text className="text-xs text-muted">{record.programmeName} · {formatDate(record.startsAt)}</Text>
      </View>
      <StatusBadge status={record.status} />
    </View>
  );
}

function SectionHeading({ title, action, href }: { title: string; action?: string; href?: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-base font-extrabold text-ink">{title}</Text>
      {action && href ? (
        <Link href={routeHref(href)} asChild>
          <Pressable accessibilityRole="button" className="min-h-10 justify-center rounded-lg px-2 active:opacity-70">
            <Text className="text-xs font-bold text-primary">{action}</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="text-xs font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-xs text-ink">{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = ['Active', 'present', 'Approved'].includes(status)
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : ['Corrections required', 'absent', 'Withdrawn'].includes(status)
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-slate-200 bg-slate-100 text-slate-700';
  return (
    <View className={`rounded-full border px-2.5 py-1 ${color}`}>
      <Text className="text-[10px] font-extrabold">{status}</Text>
    </View>
  );
}

function evidenceStatusLabel(status: string) {
  if (status === 'NOT_SUBMITTED') return 'Not submitted';
  if (status === 'SUBMITTED') return 'Submitted';
  if (status === 'UNDER_REVIEW') return 'Awaiting assessment';
  if (status === 'CORRECTION_REQUIRED') return 'Corrections required';
  if (status === 'APPROVED') return 'Approved';
  return status;
}

function activityStatusLabel(status: string) {
  if (status === 'CORRECTION_REQUESTED') return 'Corrections required';
  if (status === 'APPROVED') return 'Approved';
  if (status === 'SUBMITTED') return 'Submitted';
  if (status === 'UNDER_REVIEW') return 'Awaiting assessment';
  if (status === 'CORRECTION_REQUIRED') return 'Corrections required';
  if (status === 'present') return 'Present';
  if (status === 'absent') return 'Absent';
  if (status === 'excused') return 'Excused';
  return status;
}

function assessmentLabel(submission: LearnerEvidenceRequirement['submissions'][number]) {
  if (submission.review) {
    return submission.review.decision === 'APPROVED' ? 'Approved' : 'Corrections requested';
  }
  return submission.status === 'UNDER_REVIEW' ? 'Awaiting assessment' : 'Not reviewed yet';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function sectionTitle(section: LearnerSection) {
  if (section === 'programmes') return 'My programmes';
  if (section === 'attendance') return 'My attendance';
  if (section === 'evidence') return 'My evidence';
  return 'Your learning overview';
}

function sectionSubtitle(section: LearnerSection) {
  if (section === 'programmes') return 'View your linked training programmes and enrolment details.';
  if (section === 'attendance') return 'Review the attendance records your provider has recorded.';
  return 'Review your evidence requirements, submissions and assessor feedback.';
}
