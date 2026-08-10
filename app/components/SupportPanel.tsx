import { useEffect, useMemo, useState } from "react";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Pagination,
  SkeletonBodyText,
  Text,
  TextField,
} from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  SupportMessage,
  SupportTicketStatus,
} from "../routes/app.support-data";
import {
  closeSupportTicket,
  createSupportTicket,
  fetchSupportTicketPage,
  sendSupportMessage,
  supportKeys,
  supportTicketDetailQueryOptions,
  supportTicketListQueryOptions,
  type SupportQueryScope,
} from "../services/support-query";
import styles from "../styles/support.module.css";

interface SupportPanelProps {
  active: boolean;
  scope: SupportQueryScope | null;
}

function readableDate(value: string | null) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusBadge(status: SupportTicketStatus) {
  const labels = { CLOSED: "Closed", OPEN: "Open", PENDING: "Pending" } as const;
  if (status === "PENDING") return <Badge tone="attention">{labels[status]}</Badge>;
  if (status === "OPEN") return <Badge tone="info">{labels[status]}</Badge>;
  return <Badge>{labels[status]}</Badge>;
}

function uniqueMessages(groups: SupportMessage[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

export function SupportPanel({ active, scope }: SupportPanelProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [endChatOpen, setEndChatOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [reply, setReply] = useState("");
  const [olderMessages, setOlderMessages] = useState<SupportMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderHasMore, setOlderHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const safeScope = scope ?? { sessionId: "pending-session", shop: "pending-shop" };

  const listQuery = useQuery({
    ...supportTicketListQueryOptions(safeScope, page),
    enabled: active && Boolean(scope) && !selectedTicketId,
    refetchInterval: active && !selectedTicketId ? 10_000 : false,
  });
  const detailQuery = useQuery({
    ...supportTicketDetailQueryOptions(safeScope, selectedTicketId ?? "pending"),
    enabled: active && Boolean(scope) && Boolean(selectedTicketId),
    refetchInterval: (query) =>
      active && query.state.data?.ticket.status !== "CLOSED" ? 7_000 : false,
  });

  useEffect(() => {
    setOlderMessages([]);
    setOlderCursor(null);
    setOlderHasMore(false);
  }, [selectedTicketId]);

  const refreshSupport = async () => {
    await queryClient.invalidateQueries({ queryKey: supportKeys.all(safeScope) });
  };

  const createMutation = useMutation({
    mutationFn: () => createSupportTicket(newTitle),
    onSuccess: async ({ ticket }) => {
      setNewTicketOpen(false);
      setNewTitle("");
      setSelectedTicketId(ticket.id);
      await refreshSupport();
    },
  });
  const messageMutation = useMutation({
    mutationFn: () => sendSupportMessage(selectedTicketId!, reply),
    onSuccess: async () => {
      setReply("");
      await refreshSupport();
    },
  });
  const closeMutation = useMutation({
    mutationFn: () => closeSupportTicket(selectedTicketId!),
    onSuccess: async () => {
      setEndChatOpen(false);
      await refreshSupport();
    },
  });

  const displayedMessages = useMemo(
    () => uniqueMessages([olderMessages, detailQuery.data?.messages ?? []]),
    [detailQuery.data?.messages, olderMessages],
  );
  const effectiveOlderCursor = olderMessages.length > 0
    ? olderCursor
    : detailQuery.data?.nextBefore ?? null;
  const effectiveOlderHasMore = olderMessages.length > 0
    ? olderHasMore
    : detailQuery.data?.hasMore ?? false;
  const mutationError =
    createMutation.error ?? messageMutation.error ?? closeMutation.error;
  const canCreate = newTitle.trim().length >= 3;
  const canReply = Boolean(reply.trim()) && detailQuery.data?.ticket.status !== "CLOSED";

  const loadEarlier = async () => {
    if (!selectedTicketId || !effectiveOlderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await fetchSupportTicketPage(selectedTicketId, effectiveOlderCursor);
      setOlderMessages((current) => uniqueMessages([result.messages, current]));
      setOlderCursor(result.nextBefore);
      setOlderHasMore(result.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  const ticketList = listQuery.data?.tickets ?? [];
  const rows = ticketList.map((ticket, index) => (
    <IndexTable.Row id={ticket.id} key={ticket.id} position={index} selected={false}>
      <IndexTable.Cell>
        <button
          className={`${styles.ticketTitleButton} ${ticket.merchantUnreadCount > 0 ? styles.unread : ""}`}
          onClick={() => setSelectedTicketId(ticket.id)}
          type="button"
        >
          {ticket.title}
        </button>
      </IndexTable.Cell>
      <IndexTable.Cell>{statusBadge(ticket.status)}</IndexTable.Cell>
      <IndexTable.Cell>{ticket.lastMessage || "No messages"}</IndexTable.Cell>
      <IndexTable.Cell>{readableDate(ticket.lastMessageAt)}</IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          {ticket.merchantUnreadCount > 0 ? <Badge tone="info">{`${ticket.merchantUnreadCount} unread`}</Badge> : null}
          <Button onClick={() => setSelectedTicketId(ticket.id)} variant="plain">
            {ticket.status === "CLOSED" ? "View" : "Open"}
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <div className={styles.supportRoot}>
        <Page
          fullWidth
          title={selectedTicketId ? "Support conversation" : "Support"}
          backAction={selectedTicketId ? { content: "Tickets", onAction: () => setSelectedTicketId(null) } : undefined}
          primaryAction={
            selectedTicketId
              ? undefined
              : { content: "Open ticket", icon: PlusIcon, onAction: () => setNewTicketOpen(true) }
          }
        >
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              {selectedTicketId
                ? "Messages are shared securely with the Multi Sync support team."
                : "Create and track help requests for this Shopify store."}
            </Text>

            {mutationError ? (
              <Banner tone="critical" title="The support action failed">
                <p>{mutationError.message}</p>
              </Banner>
            ) : null}

            {!selectedTicketId ? (
              <Card padding="0">
                {listQuery.isPending ? (
                  <div style={{ padding: "2rem" }}>
                    <SkeletonBodyText lines={6} />
                  </div>
                ) : listQuery.isError ? (
                  <div style={{ padding: "1rem" }}>
                    <Banner
                      action={{ content: "Retry", onAction: () => void listQuery.refetch() }}
                      title="Tickets couldn't be loaded"
                      tone="critical"
                    >
                      <p>{listQuery.error.message}</p>
                    </Banner>
                  </div>
                ) : ticketList.length === 0 ? (
                  <EmptyState
                    action={{ content: "Open ticket", onAction: () => setNewTicketOpen(true) }}
                    heading="No support tickets yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>If you need help, open a ticket and our team will get back to you.</p>
                  </EmptyState>
                ) : (
                  <IndexTable
                    headings={[
                      { title: "Ticket" },
                      { title: "Status" },
                      { title: "Last message" },
                      { title: "Updated" },
                      { title: "Action" },
                    ]}
                    itemCount={ticketList.length}
                    resourceName={{ plural: "tickets", singular: "ticket" }}
                    selectable={false}
                  >
                    {rows}
                  </IndexTable>
                )}
              </Card>
            ) : detailQuery.isPending ? (
              <Card>
                <SkeletonBodyText lines={8} />
              </Card>
            ) : detailQuery.isError || !detailQuery.data ? (
              <Banner
                action={{ content: "Retry", onAction: () => void detailQuery.refetch() }}
                title="Conversation couldn't be loaded"
                tone="critical"
              >
                <p>{detailQuery.error?.message || "Try again."}</p>
              </Banner>
            ) : (
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" gap="300">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">{detailQuery.data.ticket.title}</Text>
                        <Text as="p" tone="subdued">
                          Opened {readableDate(detailQuery.data.ticket.createdAt)}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200">
                        {statusBadge(detailQuery.data.ticket.status)}
                        {detailQuery.data.ticket.status !== "CLOSED" ? (
                          <Button
                            loading={closeMutation.isPending}
                            onClick={() => setEndChatOpen(true)}
                            tone="critical"
                            variant="plain"
                          >
                            End chat
                          </Button>
                        ) : null}
                      </InlineStack>
                    </InlineStack>
                    <Divider />
                    <div className={styles.conversation}>
                      <BlockStack gap="300">
                        {effectiveOlderHasMore ? (
                          <InlineStack align="center">
                            <Button loading={loadingOlder} onClick={() => void loadEarlier()}>
                              Load earlier messages
                            </Button>
                          </InlineStack>
                        ) : null}
                        {displayedMessages.map((message) => {
                          const merchant = message.senderRole === "MERCHANT";
                          return (
                            <div
                              className={`${styles.messageRow} ${merchant ? styles.messageRowMerchant : ""}`}
                              key={message.id}
                            >
                              <div className={`${styles.messageBubble} ${merchant ? styles.messageBubbleMerchant : ""}`}>
                                <Text as="p">{message.message}</Text>
                                <div className={styles.messageMeta}>
                                  {merchant ? "You" : message.senderName || "Multi Sync Support"} · {readableDate(message.createdAt)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {displayedMessages.length === 0 ? (
                          <Banner title="Your ticket is open" tone="info">
                            <p>Write the first message below so our support team can help.</p>
                          </Banner>
                        ) : null}
                      </BlockStack>
                    </div>
                    {detailQuery.data.ticket.status === "CLOSED" ? (
                      <Banner title="This conversation has been closed." tone="info">
                        <p>Its message history remains available to read.</p>
                      </Banner>
                    ) : (
                      <BlockStack gap="200">
                        <TextField
                          autoComplete="off"
                          label="Reply"
                          maxLength={10000}
                          multiline={4}
                          onChange={setReply}
                          placeholder="Write a message..."
                          value={reply}
                        />
                        <InlineStack align="end">
                          <Button
                            disabled={!canReply}
                            loading={messageMutation.isPending}
                            onClick={() => messageMutation.mutate()}
                            variant="primary"
                          >
                            Send message
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>
            )}

            {!selectedTicketId && listQuery.data && listQuery.data.pagination.pageCount > 1 ? (
              <InlineStack align="center">
                <Pagination
                  hasNext={page < listQuery.data.pagination.pageCount}
                  hasPrevious={page > 1}
                  onNext={() => setPage((value) => value + 1)}
                  onPrevious={() => setPage((value) => Math.max(1, value - 1))}
                />
              </InlineStack>
            ) : null}
          </BlockStack>
        </Page>

        <Modal
          onClose={() => setNewTicketOpen(false)}
          open={newTicketOpen}
          primaryAction={{
            content: "Create ticket",
            disabled: !canCreate,
            loading: createMutation.isPending,
            onAction: () => createMutation.mutate(),
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setNewTicketOpen(false) }]}
          title="Open support ticket"
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                autoComplete="off"
                label="Ticket name"
                maxLength={150}
                onChange={setNewTitle}
                placeholder="Describe what you need help with"
                value={newTitle}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>

        <Modal
          onClose={() => setEndChatOpen(false)}
          open={endChatOpen}
          primaryAction={{
            content: "End chat",
            destructive: true,
            loading: closeMutation.isPending,
            onAction: () => closeMutation.mutate(),
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setEndChatOpen(false) }]}
          title="End this support conversation?"
        >
          <Modal.Section>
            <Text as="p">
              The ticket will be marked as closed and no new messages can be sent.
            </Text>
          </Modal.Section>
        </Modal>
      </div>
    </PolarisAppProvider>
  );
}
