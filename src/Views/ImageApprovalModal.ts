import { App } from "obsidian";
import { DetectedImage, ImageApprovalDecision } from "src/Models/Tool";
import { BaseApprovalModal } from "./BaseApprovalModal";

/**
 * Modal for approving image attachments before they are sent to the LLM
 */
export class ImageApprovalModal extends BaseApprovalModal<ImageApprovalDecision> {
  private images: DetectedImage[];

  constructor(app: App, images: DetectedImage[], modelName: string = "AI") {
    super(app, modelName);
    this.images = images;
  }

  protected getModalTitle(): string {
    return "ChatGPT MD - Images in Message";
  }

  protected getCssClass(): string {
    return "image-approval-modal";
  }

  protected getDescription(): string {
    return `${this.images.length} image${this.images.length !== 1 ? "s" : ""} were found in your message. Select which ones to share with '${this.modelName}'.`;
  }

  protected renderSelectionItems(container: HTMLElement): void {
    const label = container.createEl("p", { text: "Select which images to share:" });
    label.style.marginTop = "8px";
    label.style.marginBottom = "8px";
    label.style.fontWeight = "500";
    label.style.opacity = "0.7";

    const imagesContainer = container.createDiv();
    imagesContainer.style.marginBottom = "12px";

    for (const image of this.images) {
      if (!this.selections.has(image.title)) {
        this.selections.set(image.title, true);
      }

      const currentValue = this.selections.get(image.title) ?? false;

      const item = imagesContainer.createDiv();
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.padding = "8px";
      item.style.marginBottom = "4px";
      item.style.borderRadius = "4px";
      item.style.backgroundColor = "var(--background-secondary)";

      const checkbox = item.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = currentValue;
      checkbox.style.marginRight = "8px";
      checkbox.onchange = () => {
        this.selections.set(image.title, checkbox.checked);
      };

      const itemLabel = item.createEl("label");
      itemLabel.style.flex = "1";
      itemLabel.style.cursor = "pointer";

      const nameEl = itemLabel.createEl("div", { text: image.title });
      nameEl.style.fontWeight = "500";
      nameEl.style.fontSize = "0.95em";

      const pathEl = itemLabel.createEl("div", { text: image.path });
      pathEl.style.fontSize = "0.85em";
      pathEl.style.opacity = "0.6";
      pathEl.style.marginTop = "2px";

      itemLabel.onclick = () => {
        checkbox.checked = !checkbox.checked;
        this.selections.set(image.title, checkbox.checked);
      };
    }
  }

  protected getControlNoteText(): string {
    return "You control what data is shared. Only selected images will be visible to the AI. Deselected images remain private.";
  }

  protected getCancelText(): string {
    return "Cancel";
  }

  protected getApproveText(): string {
    return "Approve and Continue";
  }

  protected buildApprovedResult(): ImageApprovalDecision {
    const approvedImages = this.images.filter((img) => this.selections.get(img.title) === true);
    return { approved: true, approvedImages };
  }

  protected buildCancelledResult(): ImageApprovalDecision {
    return { approved: false, approvedImages: [] };
  }

  protected refreshSelectionItems(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.onOpen();
  }
}
