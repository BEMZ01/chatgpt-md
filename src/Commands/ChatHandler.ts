import { Editor, MarkdownView, Notice, Platform } from "obsidian";
import { ServiceContainer } from "src/core/ServiceContainer";
import { getHeadingPrefix } from "src/Utilities/TextHelpers";
import { getDefaultModelForService, isTitleTimestampFormat } from "src/Utilities/FrontmatterHelpers";
import { ChatGPT_MDSettings, MergedFrontmatterConfig } from "src/Models/Config";
import { Message } from "src/Models/Message";
import {
  AI_SERVICE_OPENROUTER,
  CALL_CHATGPT_API_COMMAND_ID,
  MIN_AUTO_INFER_MESSAGES,
  NOTICE_DURATION_LONG_MS,
  NOTICE_DURATION_SHORT_MS,
  PLUGIN_PREFIX,
} from "src/Constants";
// DEFAULT_*_CONFIG imports removed - using getDefaultModelForService instead
import { getAiApiUrls } from "./CommandUtilities";
import { DetectedImage } from "src/Models/Tool";
import { ImageApprovalModal } from "src/Views/ImageApprovalModal";
import { findImageEmbedsInMessage } from "src/Utilities/MessageHelpers";

/**
 * Handler for the main chat command
 * Uses constructor injection for all dependencies
 */
export class ChatHandler {
  private statusBarItemEl: HTMLElement;

  constructor(
    private services: ServiceContainer,
    private stopStreamingHandler: { setCurrentAiService: (aiService: any) => void }
  ) {
    this.statusBarItemEl = services.plugin.addStatusBarItem();
  }

  static getCommand() {
    return {
      id: CALL_CHATGPT_API_COMMAND_ID,
      name: "Chat",
      icon: "message-circle",
    };
  }

  /**
   * Execute the chat command
   */
  async execute(editor: Editor, view: MarkdownView): Promise<void> {
    const { editorService, settingsService, apiAuthService, toolService } = this.services;
    const settings = settingsService.getSettings();
    const frontmatter: MergedFrontmatterConfig = await editorService.getFrontmatter(view, settings, this.services.app);

    const aiService = this.services.aiProviderService();
    this.stopStreamingHandler.setCurrentAiService(aiService);

    try {
      // Get messages from editor
      const { messagesWithRole: messagesWithRoleAndMessage, messages } = await editorService.getMessagesFromEditor(
        editor,
        settings
      );

      // Prepend system messages (agent body + system_commands)
      const systemMessages = this.buildSystemMessages(frontmatter);
      if (systemMessages.length > 0) {
        messagesWithRoleAndMessage.unshift(...systemMessages);
      }

      // Move cursor to end of file if generateAtCursor is false
      if (!settings.generateAtCursor) {
        editorService.moveCursorToEnd(editor);
      }

      // Detect and handle image embeds in user messages
      await this.processImageAttachments(messagesWithRoleAndMessage, frontmatter.model);

      if (Platform.isMobile) {
        new Notice(`${PLUGIN_PREFIX} Calling ${frontmatter.model}`);
      } else {
        this.updateStatusBar(`Calling ${frontmatter.model}`);
      }

      // Get the appropriate API key for the service
      const apiKeyToUse = apiAuthService.getApiKey(settings, frontmatter.aiService);

      // Get tool service if tools are enabled
      const toolServiceToUse = settings.enableToolCalling ? toolService : undefined;

      const response = await aiService.callAiAPI(
        messagesWithRoleAndMessage,
        frontmatter,
        getHeadingPrefix(settings.headingLevel),
        getAiApiUrls(frontmatter)[frontmatter.aiService],
        editor,
        settings.generateAtCursor,
        apiKeyToUse,
        settings,
        toolServiceToUse
      );

      editorService.processResponse(editor, response, settings);

      if (
        settings.autoInferTitle &&
        isTitleTimestampFormat(view?.file?.basename, settings.dateFormat) &&
        messagesWithRoleAndMessage.length > MIN_AUTO_INFER_MESSAGES
      ) {
        // Create a settings object with the correct API key and model
        const settingsWithApiKey: ChatGPT_MDSettings & { url?: string; model?: string } = {
          ...settings,
          ...frontmatter,
          // Use the utility function to get the correct API key
          openrouterApiKey: apiAuthService.getApiKey(settings, AI_SERVICE_OPENROUTER),
          // Use the centralized method for URL
          url: getAiApiUrls(frontmatter)[frontmatter.aiService],
        };

        // Ensure model is set for title inference
        if (!settingsWithApiKey.model) {
          settingsWithApiKey.model = getDefaultModelForService(frontmatter.aiService);
          if (!settingsWithApiKey.model) {
            new Notice(
              `Auto title inference skipped: No model configured for ${frontmatter.aiService}. Please set a model in settings.`,
              NOTICE_DURATION_SHORT_MS
            );
            return;
          }
        }

        await aiService.inferTitle(view, settingsWithApiKey as ChatGPT_MDSettings, messages, editorService);
      }
    } catch (err) {
      if (Platform.isMobile) {
        new Notice(`${PLUGIN_PREFIX} Calling ${frontmatter.model}. ` + err, NOTICE_DURATION_LONG_MS);
      }
      this.services.errorService.handleApiError(err, "ChatHandler.execute", { showNotification: true });
    }

    this.updateStatusBar("");
  }

  /**
   * Detect image embeds in user messages, show approval modal, and attach approved images
   */
  private async processImageAttachments(messagesWithRole: Message[], modelName: string): Promise<void> {
    const { fileService } = this.services;

    // Collect all image embeds from user messages
    const detectedImages: DetectedImage[] = [];
    for (let i = 0; i < messagesWithRole.length; i++) {
      const msg = messagesWithRole[i];
      if (msg.role !== "user") continue;

      const embeds = findImageEmbedsInMessage(msg.content);
      for (const embed of embeds) {
        const resolved = await fileService.readImageFileAsUint8Array(embed.title);
        if (resolved) {
          detectedImages.push({
            embedText: embed.embedText,
            title: embed.title,
            path: resolved.path,
            messageIndex: i,
          });
        }
      }
    }

    if (detectedImages.length === 0) {
      return;
    }

    // Show approval modal
    const modal = new ImageApprovalModal(this.services.app, detectedImages, modelName);
    modal.open();
    const decision = await modal.waitForResult();

    const approvedSet = new Set(decision.approvedImages.map((img) => img.title));

    // Process each detected image
    for (const detected of detectedImages) {
      const msg = messagesWithRole[detected.messageIndex];
      const approved = approvedSet.has(detected.title);

      if (approved) {
        // Read image data and attach to message
        const imageResult = await fileService.readImageFileAsUint8Array(detected.title);
        if (imageResult) {
          const mimeType = this.getMimeTypeForImage(detected.title);

          if (!msg.images) {
            msg.images = [];
          }
          msg.images.push({ data: imageResult.data, mimeType, name: detected.title });
        }
        // Remove the embed text from the message content (image is sent as attachment)
        msg.content = msg.content.replace(detected.embedText, "").trim();
      } else {
        // Replace embed with a note that the image was not shared
        msg.content = msg.content.replace(detected.embedText, `[Image not shared: ${detected.title}]`);
      }
    }
  }

  /**
   * Get the correct MIME type for an image file based on its extension
   */
  private getMimeTypeForImage(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      tiff: "image/tiff",
      tif: "image/tiff",
      avif: "image/avif",
    };
    return mimeTypes[ext] ?? "image/png";
  }

  /**
   * Build system messages from agent body and system_commands frontmatter
   */
  private buildSystemMessages(frontmatter: MergedFrontmatterConfig): Message[] {
    const systemMessages: Message[] = [];

    // Agent body as system message
    const agentBody = frontmatter._agentSystemMessage as string | undefined;
    if (agentBody) {
      systemMessages.push({ role: "system", content: agentBody });
    }

    // system_commands from frontmatter as system messages
    if (frontmatter.system_commands && Array.isArray(frontmatter.system_commands)) {
      for (const cmd of frontmatter.system_commands) {
        if (typeof cmd === "string" && cmd.trim()) {
          systemMessages.push({ role: "system", content: cmd });
        }
      }
    }

    return systemMessages;
  }

  /**
   * Update the status bar with the given text
   */
  private updateStatusBar(text: string): void {
    this.statusBarItemEl.setText(text);
  }
}
