import {
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { AutomaticRefreshStatus } from "../routes/app.feed-refresh-schedule";
import {
  DEFAULT_FEED_REFRESH_SCHEDULE,
  feedRefreshDraftFingerprint,
  feedRefreshKeys,
  feedRefreshScheduleQueryOptions,
  feedRefreshTimezonesInfiniteQueryOptions,
  formatTime12,
  isAutomaticRefreshActive,
  parseTime24,
  saveFeedRefreshSchedule,
  scheduleDraftFrom,
  time24From12,
  type FeedRefreshScheduleDraft,
} from "../services/feed-refresh-query";
import { feedKeys, type FeedQueryScope } from "../services/feed-query";
import styles from "../styles/feeds.module.css";

interface AutomaticRefreshCardProps {
  active: boolean;
  onActivityChange: (active: boolean) => void;
  scope: FeedQueryScope | null;
}

interface TimeSelection {
  hour: number;
  minute: number;
  period: "AM" | "PM";
}

interface TimeValueOption {
  label: string;
  value: string;
}

const timeModalId = "automatic-refresh-time-modal";
const timezoneModalId = "automatic-refresh-timezone-modal";
const customRefreshLabelId = "automatic-refresh-toggle-label";
const hourPopoverId = "automatic-refresh-hour-popover";
const minutePopoverId = "automatic-refresh-minute-popover";
const periodPopoverId = "automatic-refresh-period-popover";
const hourOptions = Array.from({ length: 12 }, (_, index) => ({
  label: (index + 1).toString(),
  value: (index + 1).toString(),
}));
const minuteOptions = Array.from({ length: 60 }, (_, minute) => ({
  label: minute.toString().padStart(2, "0"),
  value: minute.toString(),
}));
const periodOptions = [
  { label: "AM", value: "AM" },
  { label: "PM", value: "PM" },
] satisfies TimeValueOption[];

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

function scheduleDate(
  value: string | null,
  timezone: string,
  locale: string | null,
) {
  if (!value) return "Never";

  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  }
}

function statusLabel(status: AutomaticRefreshStatus) {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "PROCESSING":
      return "Processing";
    case "SUCCESS":
      return "Success";
    case "FAILED":
      return "Failed";
    default:
      return "Never run";
  }
}

function AutomaticStatusBadge({
  status,
}: {
  status: AutomaticRefreshStatus;
}) {
  const tone =
    status === "SUCCESS"
      ? "success"
      : status === "FAILED"
        ? "critical"
        : isAutomaticRefreshActive(status)
          ? "info"
          : "neutral";

  return <s-badge tone={tone}>{statusLabel(status)}</s-badge>;
}

function timeSelectionFrom(value: string): TimeSelection {
  const parsed = parseTime24(value) ?? { hour: 0, minute: 0 };

  return {
    hour: parsed.hour % 12 || 12,
    minute: parsed.minute,
    period: parsed.hour >= 12 ? "PM" : "AM",
  };
}

function ScheduleLoadingState() {
  return (
    <div className={styles.scheduleLoading} aria-label="Loading refresh schedule">
      <span className={`${styles.loadingLine} ${styles.loadingLineWide}`} />
      <span className={styles.loadingLine} />
      <span className={`${styles.loadingLine} ${styles.loadingLineWide}`} />
    </div>
  );
}

function TimeValuePicker({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly TimeValueOption[];
  value: string;
}) {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? value;

  return (
    <div className={styles.timeValuePicker}>
      <span className={styles.selectorLabel}>{label}</span>
      <s-clickable
        accessibilityLabel={`Choose ${label.toLocaleLowerCase()}`}
        background="base"
        border="small-100"
        borderColor="base"
        borderRadius="base"
        borderStyle="solid"
        command="--show"
        commandFor={id}
        inlineSize="100%"
        padding="small-200 base"
      >
        <s-stack
          alignItems="center"
          direction="inline"
          gap="small"
          justifyContent="space-between"
        >
          <s-text>{selectedLabel}</s-text>
          <s-icon color="subdued" type="chevron-down" />
        </s-stack>
      </s-clickable>
      <s-popover id={id} inlineSize="180px">
        <s-box padding="small-200">
          <div className={styles.timeValueOptions}>
            {options.map((option) => (
              <s-button
                command="--hide"
                commandFor={id}
                key={option.value}
                onClick={() => onChange(option.value)}
                variant="tertiary"
              >
                <span className={styles.timeValueOptionContent}>
                  <span>{option.label}</span>
                  {option.value === value ? (
                    <s-icon type="check" />
                  ) : null}
                </span>
              </s-button>
            ))}
          </div>
        </s-box>
      </s-popover>
    </div>
  );
}

export function AutomaticRefreshCard({
  active,
  onActivityChange,
  scope,
}: AutomaticRefreshCardProps) {
  const shopify = useAppBridge();
  const queryClient = useQueryClient();
  const endpoint = "/app/feed-refresh-schedule";
  const queryScope = scope ?? {
    locale: null,
    sessionId: "pending",
    shop: "pending",
  };
  const scheduleQuery = useQuery({
    ...feedRefreshScheduleQueryOptions(queryScope, endpoint),
    enabled: active && Boolean(scope),
    refetchInterval: (query) =>
      active &&
      isAutomaticRefreshActive(query.state.data?.lastAutomaticStatus)
        ? 2_000
        : false,
    refetchIntervalInBackground: false,
  });
  const [draft, setDraft] = useState<FeedRefreshScheduleDraft | null>(null);
  const [savedDraft, setSavedDraft] =
    useState<FeedRefreshScheduleDraft | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [timeSelection, setTimeSelection] = useState<TimeSelection>(
    timeSelectionFrom("00:00"),
  );
  const [timezoneModalOpen, setTimezoneModalOpen] = useState(false);
  const [timezoneSearch, setTimezoneSearch] = useState("");
  const [timezoneSelection, setTimezoneSelection] = useState("UTC");
  const [scheduleWakeAttempt, setScheduleWakeAttempt] = useState(0);
  const debouncedTimezoneSearch = useDebouncedValue(timezoneSearch, 250);
  const hydratedScheduleKey = useRef<string | null>(null);
  const mounted = useRef(true);
  const previousStatus = useRef<AutomaticRefreshStatus | null>(null);
  const previousFinishedAt = useRef<string | null | undefined>(undefined);
  const wasActive = useRef(false);
  const schedule = scheduleQuery.data;
  const refetchSchedule = scheduleQuery.refetch;
  const scheduleDataUpdatedAt = scheduleQuery.dataUpdatedAt;
  const automaticWorkActive = isAutomaticRefreshActive(
    schedule?.lastAutomaticStatus,
  );
  const timezonesQuery = useInfiniteQuery({
    ...feedRefreshTimezonesInfiniteQueryOptions(
      queryScope,
      debouncedTimezoneSearch,
      endpoint,
    ),
    enabled:
      active &&
      Boolean(scope) &&
      timezoneModalOpen &&
      Boolean(draft?.customAutomaticRefresh),
  });
  const saveMutation = useMutation({
    mutationFn: (value: FeedRefreshScheduleDraft) =>
      saveFeedRefreshSchedule(value, endpoint),
  });

  useEffect(() => {
    if (!schedule || !scope) {
      return;
    }
    const scheduleKey = `${scope.shop}:${scope.sessionId}:${schedule.scheduleVersion}`;
    if (hydratedScheduleKey.current === scheduleKey) return;

    const incoming = scheduleDraftFrom(schedule);
    hydratedScheduleKey.current = scheduleKey;
    setDraft(incoming);
    setSavedDraft(incoming);
    setValidationError(null);
  }, [schedule, scope]);

  useEffect(() => {
    onActivityChange(automaticWorkActive);
  }, [automaticWorkActive, onActivityChange]);

  useEffect(
    () => () => {
      mounted.current = false;
      onActivityChange(false);
    },
    [onActivityChange],
  );

  useEffect(() => {
    if (active && !wasActive.current && schedule) {
      void refetchSchedule();
    }
    wasActive.current = active;
  }, [active, refetchSchedule, schedule]);

  useEffect(() => {
    const current = schedule?.lastAutomaticStatus ?? null;
    const currentFinishedAt = schedule?.lastAutomaticFinishedAt ?? null;
    const finishedSinceLastObservation =
      Boolean(currentFinishedAt) &&
      currentFinishedAt !== previousFinishedAt.current;
    if (
      ((isAutomaticRefreshActive(previousStatus.current) &&
        !isAutomaticRefreshActive(current)) ||
        finishedSinceLastObservation) &&
      scope
    ) {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: feedKeys.primary(scope, "/app/feed-data"),
        }),
        queryClient.invalidateQueries({
          queryKey: feedKeys.additional(
            scope,
            "/app/additional-feeds",
          ),
        }),
      ]);
    }
    previousStatus.current = current;
    previousFinishedAt.current = currentFinishedAt;
  }, [
    queryClient,
    schedule?.lastAutomaticFinishedAt,
    schedule?.lastAutomaticStatus,
    scope,
  ]);

  useEffect(() => {
    if (
      !active ||
      !schedule?.nextRunAt ||
      automaticWorkActive
    ) {
      return;
    }

    const untilScheduledRun =
      new Date(schedule.nextRunAt).getTime() - Date.now();
    const delay =
      untilScheduledRun > 0
        ? Math.min(untilScheduledRun + 1_000, 2_147_000_000)
        : 5_000;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void refetchSchedule().finally(() => {
        if (!cancelled) {
          setScheduleWakeAttempt((attempt) => attempt + 1);
        }
      });
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    active,
    automaticWorkActive,
    refetchSchedule,
    scheduleWakeAttempt,
    schedule?.nextRunAt,
    scheduleDataUpdatedAt,
  ]);

  const visibleTimezones = useMemo(() => {
    const values = [
      ...new Set(
        timezonesQuery.data?.pages.flatMap(
          (page) => page.timezones,
        ) ?? [],
      ),
    ];
    const selected = timezoneSelection;
    return selected && !values.includes(selected)
      ? [selected, ...values]
      : values;
  }, [timezoneSelection, timezonesQuery.data]);

  const loadMoreTimezonesNearBottom = (
    event: UIEvent<HTMLDivElement>,
  ) => {
    const results = event.currentTarget;
    const distanceFromBottom =
      results.scrollHeight - results.scrollTop - results.clientHeight;

    if (
      distanceFromBottom > 48 ||
      !timezonesQuery.hasNextPage ||
      timezonesQuery.isFetchingNextPage ||
      timezonesQuery.isFetchNextPageError
    ) {
      return;
    }

    void timezonesQuery.fetchNextPage();
  };

  const isDirty =
    draft !== null &&
    savedDraft !== null &&
    feedRefreshDraftFingerprint(draft) !==
      feedRefreshDraftFingerprint(savedDraft);
  const displayedTime =
    draft?.customAutomaticRefresh && draft.customTime
      ? draft.customTime
      : "00:00";
  const subtitle =
    draft?.customAutomaticRefresh && draft.customTime && draft.customTimezone
      ? `Your feeds refresh once per day at ${formatTime12(draft.customTime)} in ${draft.customTimezone}. You can still refresh manually at any time.`
      : "Your feeds refresh once per day at 12:00 AM UTC. You can customize the refresh time and time zone, and you can still refresh manually at any time.";

  const applySavedSchedule = (
    result: Awaited<ReturnType<typeof saveFeedRefreshSchedule>>,
  ) => {
    const incoming = scheduleDraftFrom(result);
    hydratedScheduleKey.current = `${queryScope.shop}:${queryScope.sessionId}:${result.scheduleVersion}`;
    queryClient.setQueryData(
      feedRefreshKeys.schedule(queryScope, endpoint),
      result,
    );
    setDraft(incoming);
    setSavedDraft(incoming);
    setValidationError(null);
  };

  const persistCustomEnabled = async (checked: boolean) => {
    if (!draft || saveMutation.isPending) return;

    const previous = draft;
    const value: FeedRefreshScheduleDraft = checked
      ? {
          customAutomaticRefresh: true,
          customTime: draft.customTime ?? "00:00",
          customTimezone: draft.customTimezone ?? "UTC",
        }
      : { ...DEFAULT_FEED_REFRESH_SCHEDULE };

    setDraft(value);
    setValidationError(null);

    try {
      const result = await saveMutation.mutateAsync(value);
      if (!mounted.current) return;
      applySavedSchedule(result);
      shopify.toast.show(
        checked
          ? "Custom automatic refresh enabled."
          : "Default automatic refresh restored.",
      );
    } catch (error) {
      if (!mounted.current) return;
      const message =
        error instanceof Error
          ? error.message
          : "The automatic refresh setting couldn't be saved.";
      setDraft(previous);
      setValidationError(message);
      shopify.toast.show(message, { isError: true });
    }
  };

  const openTimeModal = () => {
    if (!draft?.customAutomaticRefresh) return;
    setTimeSelection(timeSelectionFrom(draft.customTime ?? "00:00"));
    setValidationError(null);
  };

  const confirmTime = () => {
    const value = time24From12(
      timeSelection.hour,
      timeSelection.minute,
      timeSelection.period,
    );
    if (!value) {
      setValidationError("Choose a valid daily refresh time.");
      return;
    }
    setDraft((current) =>
      current ? { ...current, customTime: value } : current,
    );
    setValidationError(null);
  };

  const openTimezoneModal = () => {
    if (!draft?.customAutomaticRefresh) return;
    setTimezoneSearch("");
    setTimezoneSelection(draft.customTimezone ?? "UTC");
    setTimezoneModalOpen(true);
    setValidationError(null);
  };

  const confirmTimezone = () => {
    if (!timezoneSelection) {
      setValidationError("Choose a valid IANA timezone.");
      return;
    }
    setDraft((current) =>
      current
        ? { ...current, customTimezone: timezoneSelection }
        : current,
    );
    setValidationError(null);
  };

  const reset = () => {
    if (saveMutation.isPending) return;
    setDraft({ ...DEFAULT_FEED_REFRESH_SCHEDULE });
    setValidationError(null);
  };

  const save = async () => {
    if (!draft || saveMutation.isPending) return;

    if (draft.customAutomaticRefresh) {
      if (!draft.customTime || !parseTime24(draft.customTime)) {
        setValidationError("Choose a valid daily refresh time.");
        return;
      }
      if (!draft.customTimezone) {
        setValidationError("Choose a valid IANA timezone.");
        return;
      }
    }

    const value = draft.customAutomaticRefresh
      ? draft
      : { ...DEFAULT_FEED_REFRESH_SCHEDULE };

    try {
      const result = await saveMutation.mutateAsync(value);
      if (!mounted.current) return;
      applySavedSchedule(result);
      shopify.toast.show("Automatic refresh schedule saved.");
    } catch (error) {
      if (!mounted.current) return;
      const message =
        error instanceof Error
          ? error.message
          : "The automatic refresh schedule couldn't be saved.";
      setValidationError(message);
      shopify.toast.show(message, { isError: true });
    }
  };

  return (
    <s-section accessibilityLabel="Automatic refresh">
      <s-stack gap="base">
        <div className={styles.automaticRefreshHeader}>
          <s-heading>Automatic refresh</s-heading>
          <div className={styles.automaticRefreshToggle}>
            <span
              className={styles.automaticRefreshToggleLabel}
              id={customRefreshLabelId}
            >
              Custom automatic refresh
            </span>
            <button
              aria-checked={draft?.customAutomaticRefresh ?? false}
              aria-labelledby={customRefreshLabelId}
              className={`${styles.iosSwitch} ${
                draft?.customAutomaticRefresh
                  ? styles.iosSwitchOn
                  : styles.iosSwitchOff
              }`}
              disabled={!draft || saveMutation.isPending}
              onClick={() =>
                void persistCustomEnabled(
                  !draft?.customAutomaticRefresh,
                )
              }
              role="switch"
              type="button"
            >
              <span aria-hidden="true" className={styles.iosSwitchThumb} />
            </button>
          </div>
        </div>
        <s-paragraph color="subdued">{subtitle}</s-paragraph>

        {scheduleQuery.isError ? (
          <s-banner heading="Automatic refresh couldn't be loaded" tone="critical">
            <s-paragraph>
              {scheduleQuery.error instanceof Error
                ? scheduleQuery.error.message
                : "Try loading the schedule again."}
            </s-paragraph>
            <s-button
              loading={scheduleQuery.isFetching ? true : undefined}
              onClick={() => void scheduleQuery.refetch()}
              variant="secondary"
            >
              Try again
            </s-button>
          </s-banner>
        ) : null}

        {scheduleQuery.isPending && !schedule ? (
          <ScheduleLoadingState />
        ) : draft && schedule ? (
          <>
            <div className={styles.scheduleControls}>
              <div className={styles.scheduleField}>
                <span className={styles.selectorLabel}>
                  Daily refresh time
                </span>
                <s-clickable
                  accessibilityLabel="Choose the daily refresh time"
                  background="base"
                  border="small-100"
                  borderColor="base"
                  borderRadius="base"
                  borderStyle="solid"
                  command="--show"
                  commandFor={timeModalId}
                  disabled={
                    !draft.customAutomaticRefresh || saveMutation.isPending
                      ? true
                      : undefined
                  }
                  inlineSize="100%"
                  onClick={openTimeModal}
                  padding="small-200 base"
                >
                  <s-stack
                    alignItems="center"
                    direction="inline"
                    gap="small"
                    justifyContent="space-between"
                  >
                    <s-text
                      color={
                        draft.customAutomaticRefresh ? "base" : "subdued"
                      }
                    >
                      {formatTime12(displayedTime)}
                    </s-text>
                    <s-icon color="subdued" type="clock" />
                  </s-stack>
                </s-clickable>
              </div>

              <div className={styles.scheduleField}>
                <span className={styles.selectorLabel}>Timezone</span>
                <s-clickable
                  accessibilityLabel="Choose the automatic refresh timezone"
                  background="base"
                  border="small-100"
                  borderColor="base"
                  borderRadius="base"
                  borderStyle="solid"
                  command="--show"
                  commandFor={timezoneModalId}
                  disabled={
                    !draft.customAutomaticRefresh || saveMutation.isPending
                      ? true
                      : undefined
                  }
                  inlineSize="100%"
                  onClick={openTimezoneModal}
                  padding="small-200 base"
                >
                  <s-stack
                    alignItems="center"
                    direction="inline"
                    gap="small"
                    justifyContent="space-between"
                  >
                    <s-text
                      color={
                        draft.customAutomaticRefresh ? "base" : "subdued"
                      }
                    >
                      {draft.customTimezone ?? "Choose timezone"}
                    </s-text>
                    <s-icon color="subdued" type="globe" />
                  </s-stack>
                </s-clickable>
              </div>
            </div>

            {validationError ? (
              <s-banner heading={validationError} tone="critical" />
            ) : null}

            <dl aria-live="polite" className={styles.scheduleStatus}>
              <div className={styles.scheduleStatusRow}>
                <span
                  aria-hidden="true"
                  className={styles.scheduleStatusIcon}
                >
                  <s-icon size="base" tone="neutral" type="calendar" />
                </span>
                <dt>Next refresh</dt>
                <dd>
                  <span className={styles.primaryLabel}>
                    {scheduleDate(
                      schedule.nextRunAt,
                      schedule.effectiveTimezone,
                      scope?.locale ?? null,
                    )}
                  </span>
                </dd>
              </div>
              <div className={styles.scheduleStatusRow}>
                <span
                  aria-hidden="true"
                  className={styles.scheduleStatusIcon}
                >
                  <s-icon size="base" tone="neutral" type="clock" />
                </span>
                <dt>Last automatic refresh</dt>
                <dd>
                  <span className={styles.primaryLabel}>
                    {scheduleDate(
                      schedule.lastAutomaticFinishedAt,
                      schedule.effectiveTimezone,
                      scope?.locale ?? null,
                    )}
                  </span>
                 
                </dd>
              </div>
              <div className={styles.scheduleStatusRow}>
                <span
                  aria-hidden="true"
                  className={styles.scheduleStatusIcon}
                >
                  <s-icon
                    size="base"
                    tone={
                      schedule.lastAutomaticStatus === "SUCCESS"
                        ? "success"
                        : schedule.lastAutomaticStatus === "FAILED"
                          ? "critical"
                          : isAutomaticRefreshActive(
                                schedule.lastAutomaticStatus,
                              )
                            ? "info"
                            : "neutral"
                    }
                    type={
                      schedule.lastAutomaticStatus === "SUCCESS"
                        ? "check-circle"
                        : schedule.lastAutomaticStatus === "FAILED"
                          ? "x-circle"
                          : isAutomaticRefreshActive(
                                schedule.lastAutomaticStatus,
                              )
                            ? "in-progress"
                            : "status"
                    }
                  />
                </span>
                <dt>Last status</dt>
                <dd>
                  <AutomaticStatusBadge
                    status={schedule.lastAutomaticStatus}
                  />
                </dd>
              </div>
            </dl>

            <div className={styles.scheduleActions}>
              <s-button
                disabled={
                  saveMutation.isPending ||
                  feedRefreshDraftFingerprint(draft) ===
                    feedRefreshDraftFingerprint(
                      DEFAULT_FEED_REFRESH_SCHEDULE,
                    )
                    ? true
                    : undefined
                }
                icon="reset"
                onClick={reset}
                variant="secondary"
              >
                Reset
              </s-button>
              <s-button
                disabled={
                  !isDirty || saveMutation.isPending ? true : undefined
                }
                loading={saveMutation.isPending ? true : undefined}
                onClick={() => void save()}
                variant="primary"
              >
                Save refresh schedule
              </s-button>
            </div>
          </>
        ) : null}
      </s-stack>

      <s-modal heading="Choose daily refresh time" id={timeModalId}>
        <s-paragraph color="subdued">
          Select the local time when the daily refresh should be scheduled.
        </s-paragraph>
        <div className={styles.timePickerGrid}>
          <TimeValuePicker
            id={hourPopoverId}
            label="Hour"
            onChange={(value) =>
              setTimeSelection((current) => ({
                ...current,
                hour: Number(value),
              }))
            }
            options={hourOptions}
            value={timeSelection.hour.toString()}
          />
          <TimeValuePicker
            id={minutePopoverId}
            label="Minute"
            onChange={(value) =>
              setTimeSelection((current) => ({
                ...current,
                minute: Number(value),
              }))
            }
            options={minuteOptions}
            value={timeSelection.minute.toString()}
          />
          <TimeValuePicker
            id={periodPopoverId}
            label="AM or PM"
            onChange={(value) =>
              setTimeSelection((current) => ({
                ...current,
                period: value === "PM" ? "PM" : "AM",
              }))
            }
            options={periodOptions}
            value={timeSelection.period}
          />
        </div>
        <s-button
          command="--hide"
          commandFor={timeModalId}
          onClick={confirmTime}
          slot="primary-action"
          variant="primary"
        >
          Confirm
        </s-button>
        <s-button
          command="--hide"
          commandFor={timeModalId}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        heading="Choose timezone"
        id={timezoneModalId}
        onHide={() => {
          setTimezoneModalOpen(false);
          setTimezoneSearch("");
        }}
      >
        <div className={styles.timezoneModalContent}>
          <s-search-field
            label="Search timezones"
            labelAccessibilityVisibility="exclusive"
            onInput={(event) => setTimezoneSearch(event.currentTarget.value)}
            placeholder="Search IANA timezone"
            value={timezoneSearch}
          />
          <div
            className={styles.timezoneResults}
            onScroll={loadMoreTimezonesNearBottom}
          >
            {timezonesQuery.isPending ? (
              <div className={styles.inlineLoading}>
                <s-spinner
                  accessibilityLabel="Loading timezones"
                  size="base"
                />
              </div>
            ) : timezonesQuery.isError && !timezonesQuery.data ? (
              <div className={styles.inlineError}>
                <span className={styles.formError} role="alert">
                  Timezones could not be loaded.
                </span>
                <s-button
                  onClick={() => void timezonesQuery.refetch()}
                  variant="secondary"
                >
                  Retry
                </s-button>
              </div>
            ) : visibleTimezones.length === 0 ? (
              <div className={styles.selectorEmpty}>
                <s-text color="subdued">No timezones found.</s-text>
              </div>
            ) : (
              <>
                <s-choice-list
                  label="Timezones"
                  labelAccessibilityVisibility="exclusive"
                  name="automatic-refresh-timezone"
                  onChange={(event) =>
                    setTimezoneSelection(
                      event.currentTarget.values[0] ?? "",
                    )
                  }
                  values={[timezoneSelection]}
                >
                  {visibleTimezones.map((timezone) => (
                    <s-choice
                      accessibilityLabel={
                        timezoneSelection === timezone
                          ? `${timezone}, selected`
                          : `Select ${timezone}`
                      }
                      key={timezone}
                      value={timezone}
                    >
                      {timezone}
                    </s-choice>
                  ))}
                </s-choice-list>
                {timezonesQuery.isFetchingNextPage ? (
                  <div
                    aria-live="polite"
                    className={styles.timezonePageStatus}
                  >
                    <s-spinner
                      accessibilityLabel="Loading more IANA timezones"
                      size="base"
                    />
                    
                  </div>
                ) : timezonesQuery.isFetchNextPageError ? (
                  <div className={styles.timezonePageStatus}>
                    <span className={styles.formError} role="alert">
                      More timezones could not be loaded.
                    </span>
                    <s-button
                      onClick={() =>
                        void timezonesQuery.fetchNextPage()
                      }
                      variant="secondary"
                    >
                      Retry
                    </s-button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <s-button
          command="--hide"
          commandFor={timezoneModalId}
          disabled={!timezoneSelection ? true : undefined}
          onClick={confirmTimezone}
          slot="primary-action"
          variant="primary"
        >
          Confirm
        </s-button>
        <s-button
          command="--hide"
          commandFor={timezoneModalId}
          slot="secondary-actions"
          variant="secondary"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-section>
  );
}
