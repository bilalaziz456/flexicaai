import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { whatsAppChatUrl } from "@/core/appointments/whatsapp-share";

/**
 * "Send on WhatsApp" (owner, 2026-11-20): opens the patient's chat in the person's OWN
 * WhatsApp — the app, or WhatsApp Web — with `text` typed in; they press Send. Text
 * only: a website cannot attach a file to a WhatsApp chat. Not the WhatsApp API.
 */
export function WhatsAppShareButton({
  phone,
  text,
  label = "Send on WhatsApp",
  className,
}: {
  phone: string | null;
  text: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={whatsAppChatUrl(phone, text)}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens the patient's chat in WhatsApp with this typed in — press Send there"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
    >
      <MessageCircle className="size-3.5" aria-hidden="true" /> {label}
    </a>
  );
}
