import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { routeHref } from '@/components/programme-ui';
import {
  FindingFilter,
  findingEventLabels,
  FindingStatus,
  findingStatusLabels,
  FindingSummary,
  QaFinding,
  QaFindingEvent,
} from '@/services/qa-findings';

export const findingFilters: { value: FindingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'RESPONSE_SUBMITTED', label: 'Response submitted' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'CLOSED', label: 'Closed' },
];

export function formatDateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

export function formatDueDate(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function FindingStatusBadge({ status, overdue = false }: { status: FindingStatus; overdue?: boolean }) {
  const color = status === 'CLOSED'
    ? 'border-slate-200 bg-slate-100 text-slate-700'
    : status === 'VERIFIED'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : status === 'RESPONSE_SUBMITTED'
        ? 'border-sky-200 bg-sky-50 text-sky-900'
        : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <View className="flex-row flex-wrap justify-end gap-1">
      <View className={`rounded-full border px-2.5 py-1 ${color}`}>
        <Text className="text-[10px] font-extrabold">{findingStatusLabels[status]}</Text>
      </View>
      {overdue ? (
        <View className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1">
          <Text className="text-[10px] font-extrabold text-danger">Overdue</Text>
        </View>
      ) : null}
    </View>
  );
}

export function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`min-h-9 justify-center rounded-full border px-3 py-2 ${selected ? 'border-primary bg-selected' : 'border-border bg-white'}`}
      onPress={onPress}>
      <Text className={`text-xs font-bold ${selected ? 'text-primary' : 'text-muted'}`}>{label}</Text>
    </Pressable>
  );
}

export function FindingSummaryRow({ summary }: { summary: FindingSummary }) {
  const items = [
    { label: 'Open', value: summary.open, tone: 'text-amber-900', card: 'border-l-amber-400 bg-amber-50/60' },
    { label: 'Awaiting QA check', value: summary.response_submitted, tone: 'text-sky-900', card: 'border-l-sky-500 bg-sky-50/60' },
    { label: 'Overdue', value: summary.overdue, tone: 'text-danger', card: 'border-l-red-500 bg-red-50/60' },
    { label: 'Closed', value: summary.closed, tone: 'text-emerald-800', card: 'border-l-emerald-600 bg-emerald-50/60' },
  ];
  return (
    <View className="flex-row flex-wrap gap-3">
      {items.map((item) => (
        <View key={item.label} className={`min-w-[140px] flex-1 gap-1 rounded-2xl border border-l-4 border-border p-4 shadow-sm shadow-primary/5 ${item.card}`}>
          <Text className={`text-3xl font-extrabold ${item.tone}`}>{item.value}</Text>
          <Text className="text-xs font-bold text-muted">{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function FindingCard({ finding, href, actionLabel }: { finding: QaFinding; href: string; actionLabel: string }) {
  const accent = finding.is_overdue
    ? 'border-l-red-500'
    : finding.status === 'CLOSED' || finding.status === 'VERIFIED'
      ? 'border-l-emerald-600'
      : finding.status === 'RESPONSE_SUBMITTED'
        ? 'border-l-sky-500'
        : 'border-l-amber-400';

  return (
    <View className={`gap-3 rounded-2xl border border-l-4 border-border bg-white p-5 shadow-sm shadow-primary/5 ${accent}`}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-extrabold text-ink">{finding.requirement_title}</Text>
          <Text className="text-xs text-muted">{finding.learner_name} · {finding.learner_reference} · {finding.programme_name}</Text>
        </View>
        <FindingStatusBadge status={finding.status} overdue={finding.is_overdue} />
      </View>
      <Text className="text-sm leading-5 text-ink" numberOfLines={3}>{finding.finding}</Text>
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <Text className="text-xs text-muted">Due: {formatDueDate(finding.due_date)}</Text>
        {finding.category_label ? <Text className="text-xs text-muted">Category: {finding.category_label}</Text> : null}
        {finding.severity_label ? <Text className="text-xs text-muted">Severity: {finding.severity_label}</Text> : null}
      </View>
      <Link href={routeHref(href)} asChild>
        <Pressable accessibilityRole="button" className="min-h-10 items-center justify-center self-start rounded-xl bg-primary px-4 py-2 active:opacity-80">
          <Text className="text-sm font-bold text-white">{actionLabel}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="text-xs font-bold text-muted">{label}</Text>
      <Text className="flex-1 text-right text-xs text-ink">{value}</Text>
    </View>
  );
}

export function FindingDetailsCard({ finding }: { finding: QaFinding }) {
  return (
    <View className="gap-3 rounded-2xl border border-l-4 border-border border-l-primary bg-white p-5 shadow-sm shadow-primary/5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-extrabold text-ink">{finding.requirement_title}</Text>
          <Text className="text-sm text-muted">{finding.learner_name} · {finding.learner_reference}</Text>
        </View>
        <FindingStatusBadge status={finding.status} overdue={finding.is_overdue} />
      </View>
      <DetailRow label="Programme" value={finding.programme_name} />
      <DetailRow label="Provider" value={finding.provider_name} />
      <DetailRow label="Raised by" value={finding.qa_name} />
      <DetailRow label="Evidence version" value={String(finding.submission_version)} />
      <DetailRow label="Category" value={finding.category_label ?? 'Not set'} />
      <DetailRow label="Severity" value={finding.severity_label ?? 'Not set'} />
      <DetailRow label="Due" value={formatDueDate(finding.due_date)} />
      <DetailRow label="Recorded" value={formatDateTime(finding.created_at)} />
      <View className="gap-1 border-t border-border pt-3">
        <Text className="text-xs font-bold text-muted">Finding</Text>
        <Text className="text-sm leading-5 text-ink">{finding.finding}</Text>
      </View>
      <View className="gap-1">
        <Text className="text-xs font-bold text-muted">Required corrective action</Text>
        <Text className="text-sm leading-5 text-ink">{finding.corrective_action}</Text>
      </View>
      {finding.provider_response ? (
        <View className="gap-1 rounded-xl bg-surface p-3">
          <Text className="text-xs font-bold text-muted">Current provider response · {formatDateTime(finding.responded_at)}</Text>
          <Text className="text-sm leading-5 text-ink">{finding.provider_response}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function FindingHistory({ events }: { events: QaFindingEvent[] }) {
  return (
    <View className="gap-3">
      <Text className="text-base font-extrabold text-ink">History</Text>
      <Text className="text-xs leading-4 text-muted">Every step is recorded permanently and cannot be edited.</Text>
      {events.map((event) => (
        <View key={event.id} className="gap-2 rounded-xl border border-border bg-white p-4 shadow-sm shadow-primary/5">
          <Text className="text-sm font-bold text-ink">{findingEventLabels[event.event_type]}</Text>
          <Text className="text-xs text-muted">
            {event.actor_name} ({event.actor_role === 'qa' ? 'QA Officer' : 'Provider'}) · {formatDateTime(event.created_at)}
          </Text>
          {event.comments ? <Text className="text-sm leading-5 text-ink">{event.comments}</Text> : null}
        </View>
      ))}
    </View>
  );
}
