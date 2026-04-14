/**
 * Represents a single message in a conversation
 *
 * @property role - The message role (e.g., "user", "assistant", "system", "developer")
 * @property content - The text content of the message
 * @property images - Optional image attachments to be sent with the message
 */
export interface Message {
  role: string;
  content: string;
  images?: Array<{ data: Uint8Array; mimeType: string; name: string }>;
}
