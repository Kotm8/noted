import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { WritingSidebar } from "../../components/ui/writing-sidebar";
import { Notice } from "../../components/ui/notice";
import { Button } from "../../components/ui/button";
import { journalsApi } from "./api";
import { JournalEditor } from "./journal-editor";

export function JournalSidebar({
  entryId,
  editing,
  onClose,
}: {
  entryId: string;
  editing: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["journal-entry", entryId],
    queryFn: () => journalsApi.get(entryId),
    refetchInterval: 15000,
  });
  if (query.data)
    return (
      <JournalEditor
        key={entryId}
        entry={query.data}
        initiallyEditing={editing}
        onClose={onClose}
      />
    );
  return (
    <WritingSidebar title="Journal entry" onClose={onClose}>
      {query.isError ? (
        <Notice tone="error">
          {query.error.message}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Notice>
      ) : (
        <div className="feed-loading">
          <LoaderCircle size={20} className="spin" />
        </div>
      )}
    </WritingSidebar>
  );
}
