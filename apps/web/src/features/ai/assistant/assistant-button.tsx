import { Sparkles } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useOptionalAssistant } from "./context";

export function AssistantButton() {
  const assistant = useOptionalAssistant();
  return (
    <Button
      variant="ghost"
      size="small"
      aria-expanded={assistant?.open}
      onClick={() => window.dispatchEvent(new Event("noted:assistant-open"))}
    >
      <Sparkles size={16} />
      Ask AI
    </Button>
  );
}
