import {
	App,
	Editor,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TextComponent,
	setIcon,
	FileSystemAdapter,
	RequestUrlParam,
	requestUrl,
	TFile,
	MarkdownView,
} from "obsidian";
import { HttpRequest, HttpResponse } from "@aws-sdk/protocol-http";
import { HttpHandlerOptions } from "@aws-sdk/types";
import { buildQueryString } from "@aws-sdk/querystring-builder";
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout";

import {
	FetchHttpHandler,
	FetchHttpHandlerOptions,
} from "@smithy/fetch-http-handler";

import { filesize } from "filesize";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import imageCompression from "browser-image-compression";

// Remember to rename these classes and interfaces!!

interface pasteFunction {
	(
		this: HTMLElement,
		event: ClipboardEvent | DragEvent,
		editor: Editor
	): void;
}

interface S3UploaderSettings {
	accessKey: string;
	secretKey: string;
	region: string;
	bucket: string;
	folder: string;
	imageUrlPath: string;
	uploadOnDrag: boolean;
	localUpload: boolean;
	localUploadFolder: string;
	useCustomEndpoint: boolean;
	customEndpoint: string;
	forcePathStyle: boolean;
	useCustomImageUrl: boolean;
	customImageUrl: string;
	uploadVideo: boolean;
	uploadAudio: boolean;
	uploadPdf: boolean;
	bypassCors: boolean;
	queryStringValue: string;
	queryStringKey: string;
	enableImageCompression: boolean;
	maxImageCompressionSize: number;
	imageCompressionQuality: number;
	maxImageWidthOrHeight: number;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKey: "",
	secretKey: "",
	region: "",
	bucket: "",
	folder: "",
	imageUrlPath: "",
	uploadOnDrag: true,
	localUpload: false,
	localUploadFolder: "",
	useCustomEndpoint: false,
	customEndpoint: "",
	forcePathStyle: false,
	useCustomImageUrl: false,
	customImageUrl: "",
	uploadVideo: false,
	uploadAudio: false,
	uploadPdf: false,
	bypassCors: false,
	queryStringValue: "",
	queryStringKey: "",
	enableImageCompression: false,
	maxImageCompressionSize: 1,
	imageCompressionQuality: 0.7,
	maxImageWidthOrHeight: 4096,
};

export default class S3UploaderPlugin extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
	pasteFunction: pasteFunction;

	private async replaceText(
		editor: Editor,
		target: string,
		replacement: string
	): Promise<void> {
		const content = editor.getValue();
		const position = content.indexOf(target);

		console.log("replaceText called:", { target, replacement });

		if (position !== -1) {
			console.log("Target found at position:", position);

			// Check if we're in a table by looking for pipe characters around the target
			const surroundingBefore = content.substring(
				Math.max(0, position - 20),
				position
			);
			const surroundingAfter = content.substring(
				position + target.length,
				Math.min(content.length, position + target.length + 20)
			);

			console.log("Surrounding text:", {
				before: surroundingBefore,
				after: surroundingAfter,
			});

			const isInTable =
				surroundingBefore.includes("|") &&
				surroundingAfter.includes("|");
			console.log("Is in table:", isInTable);

			// For tables, we need to be more careful with the replacement
			if (isInTable) {
				// Get the line containing the target
				const from = editor.offsetToPos(position);
				const to = editor.offsetToPos(position + target.length);

				console.log("Table replacement positions:", { from, to });

				try {
					// Use a more direct approach for tables
					editor.transaction({
						changes: [
							{
								from,
								to,
								text: replacement,
							},
						],
					});
					console.log("Table transaction completed");

					// Force a refresh of the editor to ensure the table renders correctly
					setTimeout(() => {
						try {
							editor.refresh();
							console.log("Editor refreshed");
						} catch (e) {
							console.error("Error refreshing editor:", e);
						}
					}, 100); // Increased timeout for better reliability
				} catch (e) {
					console.error("Error during table transaction:", e);
				}
			} else {
				// Normal replacement for non-table content
				const from = editor.offsetToPos(position);
				const to = editor.offsetToPos(position + target.length);

				console.log("Normal replacement positions:", { from, to });

				try {
					editor.transaction({
						changes: [
							{
								from,
								to,
								text: replacement,
							},
						],
					});
					console.log("Normal transaction completed");
				} catch (e) {
					console.error("Error during normal transaction:", e);
				}
			}
		} else {
			console.log("Target not found in content");
		}
	}

	async uploadFile(file: File, key: string): Promise<string> {
		const buf = await file.arrayBuffer();
		await this.s3.send(
			new PutObjectCommand({
				Bucket: this.settings.bucket,
				Key: key,
				Body: new Uint8Array(buf),
				ContentType: file.type,
			})
		);
		let urlString = this.settings.imageUrlPath + key;
		if (this.settings.queryStringKey && this.settings.queryStringValue) {
			const urlObject = new URL(urlString);

			// The searchParams property provides methods to manipulate query parameters
			urlObject.searchParams.append(
				this.settings.queryStringKey,
				this.settings.queryStringValue
			);
			urlString = urlObject.toString();
		}
		return urlString;
	}

	async compressImage(file: File): Promise<ArrayBuffer> {
		const compressedFile = await imageCompression(file, {
			useWebWorker: false,
			maxWidthOrHeight: this.settings.maxImageWidthOrHeight,
			maxSizeMB: this.settings.maxImageCompressionSize,
			initialQuality: this.settings.imageCompressionQuality,
		});

		const fileBuffer = await compressedFile.arrayBuffer();
		const originalSize = filesize(file.size); // Input file size
		const newSize = filesize(compressedFile.size);

		new Notice(`Image compressed from ${originalSize} to ${newSize}`);

		return fileBuffer;
	}

	async pasteHandler(
		ev: ClipboardEvent | DragEvent | Event | null,
		editor: Editor,
		directFile?: File
	): Promise<void> {
		if (ev?.defaultPrevented) {
			return;
		}

		const noteFile = this.app.workspace.getActiveFile();
		if (!noteFile || !noteFile.name) return;

		const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter;
		const localUpload = fm?.localUpload ?? this.settings.localUpload;
		const uploadVideo = fm?.uploadVideo ?? this.settings.uploadVideo;
		const uploadAudio = fm?.uploadAudio ?? this.settings.uploadAudio;
		const uploadPdf = fm?.uploadPdf ?? this.settings.uploadPdf;

		let files: File[] = [];
		if (directFile) {
			files = [directFile];
		} else if (ev) {
			switch (ev.type) {
				case "paste":
					files = Array.from(
						(ev as ClipboardEvent).clipboardData?.files || []
					);
					break;
				case "drop":
					if (
						!this.settings.uploadOnDrag &&
						!(fm && fm.uploadOnDrag)
					) {
						return;
					}
					files = Array.from(
						(ev as DragEvent).dataTransfer?.files || []
					);
					break;
				case "input":
					files = Array.from(
						(ev.target as HTMLInputElement).files || []
					);
					break;
			}
		}

		// Only prevent default if we have files to handle
		if (files.length > 0) {
			if (ev) ev.preventDefault();
			new Notice("Uploading files...");

			// Remember cursor position before any changes
			const cursorPos = editor.getCursor();

			const uploads = files.map(async (file) => {
				let thisType = "";
				if (file.type.match(/video.*/) && uploadVideo) {
					thisType = "video";
				} else if (file.type.match(/audio.*/) && uploadAudio) {
					thisType = "audio";
				} else if (file.type.match(/application\/pdf/) && uploadPdf) {
					thisType = "pdf";
				} else if (file.type.match(/image.*/)) {
					thisType = "image";
				} else if (
					file.type.match(/presentation.*/) ||
					file.type.match(/powerpoint.*/)
				) {
					thisType = "ppt";
				}
				if (!thisType) {
					return;
				}

				// Process the file
				let buf = await file.arrayBuffer();
				const digest = await generateFileHash(new Uint8Array(buf));
				const newFileName = `${digest}.${file.name.split(".").pop()}`;

				// Determine folder
				let folder = "";
				if (localUpload) {
					folder =
						fm?.uploadFolder ?? this.settings.localUploadFolder;
				} else {
					folder = fm?.uploadFolder ?? this.settings.folder;
				}

				const currentDate = new Date();
				folder = folder
					.replace("${year}", currentDate.getFullYear().toString())
					.replace(
						"${month}",
						String(currentDate.getMonth() + 1).padStart(2, "0")
					)
					.replace(
						"${day}",
						String(currentDate.getDate()).padStart(2, "0")
					);
				const key = folder ? `${folder}/${newFileName}` : newFileName;

				try {
					// Upload the file
					let url;

					// Image compression
					if (
						thisType === "image" &&
						this.settings.enableImageCompression
					) {
						buf = await this.compressImage(file);
						file = new File([buf], newFileName, {
							type: file.type,
						});
					}

					if (!localUpload) {
						url = await this.uploadFile(file, key);
					} else {
						await this.app.vault.adapter.writeBinary(
							key,
							new Uint8Array(buf)
						);
						url =
							this.app.vault.adapter instanceof FileSystemAdapter
								? this.app.vault.adapter.getFilePath(key)
								: key;
					}

					// Generate the markdown
					return wrapFileDependingOnType(url, thisType, "");
				} catch (error) {
					console.error(error);
					return `Error uploading file: ${error.message}`;
				}
			});

			try {
				// Wait for all uploads to complete
				const results = await Promise.all(uploads);

				// Filter out undefined results (from unsupported file types)
				const validResults = results.filter(
					(result) => result !== undefined
				);

				// Insert all results at once at the cursor position
				if (validResults.length > 0) {
					// Use a safer approach to insert text
					const text = validResults.join("\n");

					// Use transaction API instead of replaceSelection
					editor.transaction({
						changes: [
							{
								from: cursorPos,
								text: text,
							},
						],
					});

					new Notice("All files uploaded successfully");
				}
			} catch (error) {
				console.error("Error during upload or insertion:", error);
				new Notice(`Error: ${error.message}`);
			}
		}
	}

	createS3Client(): void {
		const apiEndpoint = this.settings.useCustomEndpoint
			? this.settings.customEndpoint
			: `https://s3.${this.settings.region}.amazonaws.com/`;
		this.settings.imageUrlPath = this.settings.useCustomImageUrl
			? this.settings.customImageUrl
			: this.settings.forcePathStyle
			? apiEndpoint + this.settings.bucket + "/"
			: apiEndpoint.replace("://", `://${this.settings.bucket}.`);

		if (this.settings.bypassCors) {
			this.s3 = new S3Client({
				region: this.settings.region,
				credentials: {
					// clientConfig: { region: this.settings.region },
					accessKeyId: this.settings.accessKey,
					secretAccessKey: this.settings.secretKey,
				},
				endpoint: apiEndpoint,
				forcePathStyle: this.settings.forcePathStyle,
				requestHandler: new ObsHttpHandler({ keepAlive: false }),
			});
		} else {
			this.s3 = new S3Client({
				region: this.settings.region,
				credentials: {
					// clientConfig: { region: this.settings.region },
					accessKeyId: this.settings.accessKey,
					secretAccessKey: this.settings.secretKey,
				},
				endpoint: apiEndpoint,
				forcePathStyle: this.settings.forcePathStyle,
				requestHandler: new ObsHttpHandler({ keepAlive: false }),
			});
		}
	}

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new S3UploaderSettingTab(this.app, this));

		this.createS3Client();

		// Add command to replace wiki links with S3 URLs
		this.addCommand({
			id: "replace-wiki-links-with-s3",
			name: "Replace wiki links with S3 URL",
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					await this.processDownloadedImages(activeFile);
				} else {
					new Notice("No active markdown file");
				}
			}
		});

		this.addCommand({
			id: "upload-image",
			name: "Upload image",
			icon: "image-plus",
			mobileOnly: false,
			editorCallback: (editor) => {
				const input = document.createElement("input");
				input.type = "file";
				input.oninput = (event) => {
					if (!event.target) return;
					this.pasteHandler(event, editor);
				};
				input.click();
				input.remove(); // delete element
			},
		});

		this.pasteFunction = (
			event: ClipboardEvent | DragEvent,
			editor: Editor
		) => {
			this.pasteHandler(event, editor);
		};

		this.registerEvent(
			this.app.workspace.on("editor-paste", this.pasteFunction)
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.pasteFunction)
		);
		// Add mobile-specific event monitoring
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;

				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) return;

				try {
					const fileContent = await this.app.vault.readBinary(file);
					const newFile = new File([fileContent], file.name, {
						type: `image/${file.extension}`,
					});

					// Do the upload
					await this.pasteHandler(null, activeView.editor, newFile);

					// Small delay to ensure editor content is updated
					await new Promise((resolve) => setTimeout(resolve, 50));

					// Now remove the original link if it exists
					const content = activeView.editor.getValue();
					// Check if the "Use [[Wikilinks]]" option is disabled
					const obsidianLink = (this.app.vault as any).getConfig(
						"useMarkdownLinks"
					)
						? `![](${file.name.split(" ").join("%20")})`
						: `![[${file.name}]]`; // Exact pattern we want to find
					const position = content.indexOf(obsidianLink);

					if (position !== -1) {
						const from = activeView.editor.offsetToPos(position);
						const to = activeView.editor.offsetToPos(
							position + obsidianLink.length
						);
						activeView.editor.replaceRange("", from, to);
					} else {
						new Notice(`Failed to find: ${obsidianLink}`);
					}

					await this.app.vault.delete(file);
				} catch (error) {
					new Notice(`Error processing file: ${error.message}`);
				}
			})
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Process downloaded images in a file, replacing them with S3 links
	 * This function is meant to be used after "Download attachments for current file" Obsidian command
	 * It identifies wiki links and replaces them with corresponding S3 links, then removes duplicate S3 links
	 */
	async processDownloadedImages(file: TFile): Promise<void> {
		try {
			// Get the content of the file
			const content = await this.app.vault.read(file);

			// Get editor for this file
			let editor: Editor | null = null;

			// Try to find an open editor for this file
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			for (const leaf of leaves) {
				const view = leaf.view as MarkdownView;
				if (view.file && view.file.path === file.path) {
					editor = view.editor;
					break;
				}
			}

			// If no editor is found but we have an active editor, check if it's for the right file
			if (!editor) {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.file && activeView.file.path === file.path) {
					editor = activeView.editor;
				}
			}

			// Still no editor, we'll have to use file operations instead
			if (!editor) {
				new Notice("No editor found for this file, changes will be saved directly");
				return; // Exit if no editor found
			}

			// Find all wiki links in the file
			const wikiLinkRegex = /!\[\[(.*?)(?:\|(.*?))?\]\]/g;
			const wikiMatches = [...content.matchAll(wikiLinkRegex)];

			if (wikiMatches.length === 0) {
				new Notice("No wiki links found in the document");
				return;
			}

			// Find all S3 links in the file
			const s3LinkRegex = /!\[(.*?)\]\((https?:\/\/.*?)\)/g;
			const allS3Matches = [...content.matchAll(s3LinkRegex)];

			if (allS3Matches.length === 0) {
				new Notice("No S3 links found. Please process images manually.");
				return;
			}

			// Find groups of consecutive S3 links
			const s3Groups: { start: number, end: number, count: number, text: string, links: RegExpMatchArray[] }[] = [];
			let currentGroup = { start: -1, end: -1, count: 0, text: "", links: [] as RegExpMatchArray[] };

			// Analyze each line to identify groups of consecutive S3 links
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const s3LinksInLine = [...line.matchAll(s3LinkRegex)];

				if (s3LinksInLine.length > 0) {
					// Start a new group or extend existing group
					if (currentGroup.start === -1) {
						currentGroup = {
							start: i,
							end: i,
							count: s3LinksInLine.length,
							text: line,
							links: [...s3LinksInLine]
						};
					} else {
						currentGroup.end = i;
						currentGroup.count += s3LinksInLine.length;
						currentGroup.text += "\n" + line;
						currentGroup.links.push(...s3LinksInLine);
					}
				} else if (currentGroup.start !== -1) {
					// End the group and save it
					s3Groups.push({ ...currentGroup });
					currentGroup = { start: -1, end: -1, count: 0, text: "", links: [] };
				}
			}

			// Save the last group if exists
			if (currentGroup.start !== -1) {
				s3Groups.push({ ...currentGroup });
			}

			// Find the group with the most S3 links
			if (s3Groups.length === 0) {
				new Notice("No consecutive groups of S3 links found");
				return;
			}

			// Identify the group with the most S3 links
			const largestGroup = s3Groups.reduce((max, group) =>
				group.count > max.count ? group : max, s3Groups[0]);

			// Check if the number of wiki links matches the number of S3 links
			if (largestGroup.count !== wikiMatches.length) {
				new Notice(`Number of wiki links (${wikiMatches.length}) doesn't match S3 links (${largestGroup.count})`);
				return;
			}

			// Extract S3 links from the largest group
			const s3LinksInLargestGroup = largestGroup.links;

			// Reverse S3 links to match wiki links in correct order
			const reversedS3Links = [...s3LinksInLargestGroup].reverse();

			// Save cursor position
			const cursorPos = editor.getCursor();

			// Replace wiki links with corresponding S3 links
			let processedCount = 0;
			for (let i = 0; i < wikiMatches.length; i++) {
				const wikiMatch = wikiMatches[i];
				const s3Match = reversedS3Links[i];

				const wikiLink = wikiMatch[0]; // ![[filename|title]]
				const s3Link = s3Match[0];    // ![title](https://...)

				// Replace in editor
				await this.replaceText(editor, wikiLink, s3Link);
				processedCount++;
			}

			// Remove duplicate S3 links from the largest group
			if (processedCount > 0) {
				// Process each line in the group
				for (let lineIndex = largestGroup.start; lineIndex <= largestGroup.end; lineIndex++) {
					// Get current line (after wiki link replacement)
					const currentLine = editor.getLine(lineIndex);

					// Find S3 links in the line
					const s3LinksInLine = [...currentLine.matchAll(s3LinkRegex)];

					if (s3LinksInLine.length > 0) {
						// Create a line with S3 links removed
						let updatedLine = currentLine;
						for (const s3Link of s3LinksInLine) {
							updatedLine = updatedLine.replace(s3Link[0], "");
						}

						// Replace the line
						const lineStart = { line: lineIndex, ch: 0 };
						const lineEnd = { line: lineIndex, ch: currentLine.length };
						editor.replaceRange(updatedLine, lineStart, lineEnd);
					}
				}

				// Restore cursor position
				editor.setCursor(cursorPos);

				new Notice(`Replaced ${processedCount} wiki links with S3 links and removed duplicates`);
			}

		} catch (error) {
			console.error("Error in processDownloadedImages:", error);
			new Notice(`Error processing images: ${error.message}`);
		}
	}
}

class S3UploaderSettingTab extends PluginSettingTab {
	plugin: S3UploaderPlugin;
	// Add properties to store compression setting elements
	private compressionSizeSettings: Setting;
	private compressionQualitySettings: Setting;
	private compressionDimensionSettings: Setting;

	constructor(app: App, plugin: S3UploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Toggle visibility of compression settings
	 * @param show Whether to show the compression settings
	 */
	private toggleCompressionSettings(show: boolean): void {
		if (
			this.compressionSizeSettings &&
			this.compressionQualitySettings &&
			this.compressionDimensionSettings
		) {
			const displayStyle = show ? "" : "none";
			this.compressionSizeSettings.settingEl.style.display = displayStyle;
			this.compressionQualitySettings.settingEl.style.display =
				displayStyle;
			this.compressionDimensionSettings.settingEl.style.display =
				displayStyle;
		}
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for S3 Image Uploader" });

		containerEl.createEl("br");

		const coffeeDiv = containerEl.createDiv("coffee");
		const coffeeLink = coffeeDiv.createEl("a", {
			href: "https://www.buymeacoffee.com/jvsteiner",
		});
		const coffeeImg = coffeeLink.createEl("img", {
			attr: {
				src: "https://cdn.buymeacoffee.com/buttons/v2/default-blue.png",
			},
		});
		coffeeImg.height = 45;
		containerEl.createEl("br");

		new Setting(containerEl)
			.setName("AWS Access Key ID")
			.setDesc("AWS access key ID for a user with S3 access.")
			.addText((text) => {
				wrapTextWithPasswordHide(text);
				text.setPlaceholder("access key")
					.setValue(this.plugin.settings.accessKey)
					.onChange(async (value) => {
						this.plugin.settings.accessKey = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("AWS Secret Key")
			.setDesc("AWS secret key for that user.")
			.addText((text) => {
				wrapTextWithPasswordHide(text);
				text.setPlaceholder("secret key")
					.setValue(this.plugin.settings.secretKey)
					.onChange(async (value) => {
						this.plugin.settings.secretKey = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Region")
			.setDesc("AWS region of the S3 bucket.")
			.addText((text) =>
				text
					.setPlaceholder("aws region")
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("S3 Bucket")
			.setDesc("S3 bucket name.")
			.addText((text) =>
				text
					.setPlaceholder("bucket name")
					.setValue(this.plugin.settings.bucket)
					.onChange(async (value) => {
						this.plugin.settings.bucket = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bucket folder")
			.setDesc(
				"Optional folder in s3 bucket. Support the use of ${year}, ${month}, and ${day} variables."
			)
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Upload on drag")
			.setDesc(
				"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadOnDrag)
					.onChange(async (value) => {
						this.plugin.settings.uploadOnDrag = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Upload video files")
			.setDesc(
				"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadVideo)
					.onChange(async (value) => {
						this.plugin.settings.uploadVideo = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Upload audio files")
			.setDesc(
				"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadAudio)
					.onChange(async (value) => {
						this.plugin.settings.uploadAudio = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Upload pdf files")
			.setDesc(
				"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadPdf)
					.onChange(async (value) => {
						this.plugin.settings.uploadPdf = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Copy to local folder")
			.setDesc(
				"Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note.  This will copy the images to a folder in your local file system, instead of s3."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.localUpload)
					.onChange(async (value) => {
						this.plugin.settings.localUpload = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Local folder")
			.setDesc(
				'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note.  This affects only local uploads.'
			)
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.localUploadFolder)
					.onChange(async (value) => {
						this.plugin.settings.localUploadFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Use custom endpoint")
			.setDesc("Use the custom api endpoint below.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useCustomEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.useCustomEndpoint = value;
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Custom S3 Endpoint")
			.setDesc(
				"Optionally set a custom endpoint for any S3 compatible storage provider."
			)
			.addText((text) =>
				text
					.setPlaceholder("https://s3.myhost.com/")
					.setValue(this.plugin.settings.customEndpoint)
					.onChange(async (value) => {
						value = value.match(/^https?:\/\//) // Force to start http(s)://
							? value
							: "https://" + value;
						value = value.replace(/([^/])$/, "$1/"); // Force to end with slash
						this.plugin.settings.customEndpoint = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("S3 Path Style URLs")
			.setDesc(
				"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com)."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.forcePathStyle)
					.onChange(async (value) => {
						this.plugin.settings.forcePathStyle = value;
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Use custom image URL")
			.setDesc("Use the custom image URL below.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useCustomImageUrl)
					.onChange(async (value) => {
						this.plugin.settings.useCustomImageUrl = value;
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Custom Image URL")
			.setDesc(
				"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.customImageUrl)
					.onChange(async (value) => {
						value = value.match(/^https?:\/\//) // Force to start http(s)://
							? value
							: "https://" + value;
						value = value.replace(/([^/])$/, "$1/"); // Force to end with slash
						this.plugin.settings.customImageUrl = value.trim();
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bypass local CORS check")
			.setDesc(
				"Bypass local CORS preflight checks - it might work on later versions of Obsidian."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bypassCors)
					.onChange(async (value) => {
						this.plugin.settings.bypassCors = value;
						this.plugin.createS3Client();
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Query String Key")
			.setDesc("Appended to the end of the URL. Optional")
			.addText((text) =>
				text
					.setPlaceholder("Empty means no query string key")
					.setValue(this.plugin.settings.queryStringKey)
					.onChange(async (value) => {
						this.plugin.settings.queryStringKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Query String Value")
			.setDesc("Appended to the end of the URL. Optional")
			.addText((text) =>
				text
					.setPlaceholder("Empty means no query string value")
					.setValue(this.plugin.settings.queryStringValue)
					.onChange(async (value) => {
						this.plugin.settings.queryStringValue = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable Image Compression")
			.setDesc("This will reduce the size of images before uploading.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableImageCompression)
					.onChange(async (value) => {
						this.plugin.settings.enableImageCompression = value;
						await this.plugin.saveSettings();

						// Show or hide compression settings based on toggle value
						this.toggleCompressionSettings(value);
					});
			});

		// Always create the compression settings, but control visibility
		this.compressionSizeSettings = new Setting(containerEl)
			.setName("Max Image Size")
			.setDesc(
				"Maximum size of the image after compression in MB. Default is 1MB."
			)
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(
						this.plugin.settings.maxImageCompressionSize.toString()
					)
					.onChange(async (value) => {
						// It must be a number, it must be greater than 0
						const newValue = parseFloat(value);
						if (isNaN(newValue) || newValue <= 0) {
							new Notice(
								"Max Image Compression Size must be a number greater than 0"
							);
							return;
						}

						this.plugin.settings.maxImageCompressionSize = newValue;
						await this.plugin.saveSettings();
					})
			);

		this.compressionQualitySettings = new Setting(containerEl)
			.setName("Image Compression Quality")
			.setDesc(
				"Maximum quality of the image after compression. Default is 0.7."
			)
			.addSlider((slider) => {
				slider.setDynamicTooltip();
				slider.setLimits(0.0, 1.0, 0.05);
				slider.setValue(this.plugin.settings.imageCompressionQuality);
				slider.onChange(async (value) => {
					this.plugin.settings.imageCompressionQuality = value;
					await this.plugin.saveSettings();
				});
			});

		this.compressionDimensionSettings = new Setting(containerEl)
			.setName("Max Image Width or Height")
			.setDesc(
				"Maximum width or height of the image after compression. Default is 4096px."
			)
			.addText((text) =>
				text
					.setPlaceholder("4096")
					.setValue(
						this.plugin.settings.maxImageWidthOrHeight.toString()
					)
					.onChange(async (value) => {
						const parsedValue = parseInt(value);

						if (isNaN(parsedValue) || parsedValue <= 0) {
							new Notice(
								"Max Image Width or Height must be a number greater than 0"
							);
							return;
						}

						this.plugin.settings.maxImageWidthOrHeight =
							parsedValue;
						await this.plugin.saveSettings();
					})
			);

		// Set initial visibility based on current settings
		this.toggleCompressionSettings(
			this.plugin.settings.enableImageCompression
		);
	}
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
	const hider = text.inputEl.insertAdjacentElement(
		"beforebegin",
		createSpan()
	);
	if (!hider) {
		return;
	}
	setIcon(hider as HTMLElement, "eye-off");

	hider.addEventListener("click", () => {
		const isText = text.inputEl.getAttribute("type") === "text";
		if (isText) {
			setIcon(hider as HTMLElement, "eye-off");
			text.inputEl.setAttribute("type", "password");
		} else {
			setIcon(hider as HTMLElement, "eye");
			text.inputEl.setAttribute("type", "text");
		}
		text.inputEl.focus();
	});
	text.inputEl.setAttribute("type", "password");
	return text;
};

const wrapFileDependingOnType = (
	location: string,
	type: string,
	localBase: string
) => {
	const srcPrefix = localBase ? "file://" + localBase + "/" : "";

	if (type === "image") {
		return `![image](${location})`;
	} else if (type === "video") {
		return `<video src="${srcPrefix}${location}" controls />`;
	} else if (type === "audio") {
		return `<audio src="${srcPrefix}${location}" controls />`;
	} else if (type === "pdf") {
		if (localBase) {
			throw new Error("PDFs cannot be embedded in local mode");
		}
		return `<iframe frameborder=0 border=0 width=100% height=800
		src="https://docs.google.com/viewer?embedded=true&url=${location}?raw=true">
		</iframe>`;
	} else if (type === "ppt") {
		return `<iframe
	    src='https://view.officeapps.live.com/op/embed.aspx?src=${location}'
	    width='100%' height='600px' frameborder='0'>
	  </iframe>`;
	} else {
		throw new Error("Unknown file type");
	}
};

////////////////////////////////////////////////////////////////////////////////
// special handler using Obsidian requestUrl
////////////////////////////////////////////////////////////////////////////////

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
class ObsHttpHandler extends FetchHttpHandler {
	requestTimeoutInMs: number | undefined;
	constructor(options?: FetchHttpHandlerOptions) {
		super(options);
		this.requestTimeoutInMs =
			options === undefined ? undefined : options.requestTimeout;
	}
	async handle(
		request: HttpRequest,
		{ abortSignal }: HttpHandlerOptions = {}
	): Promise<{ response: HttpResponse }> {
		if (abortSignal?.aborted) {
			const abortError = new Error("Request aborted");
			abortError.name = "AbortError";
			return Promise.reject(abortError);
		}

		let path = request.path;
		if (request.query) {
			const queryString = buildQueryString(request.query);
			if (queryString) {
				path += `?${queryString}`;
			}
		}

		const { port, method } = request;
		const url = `${request.protocol}//${request.hostname}${
			port ? `:${port}` : ""
		}${path}`;
		const body =
			method === "GET" || method === "HEAD" ? undefined : request.body;

		const transformedHeaders: Record<string, string> = {};
		for (const key of Object.keys(request.headers)) {
			const keyLower = key.toLowerCase();
			if (keyLower === "host" || keyLower === "content-length") {
				continue;
			}
			transformedHeaders[keyLower] = request.headers[key];
		}

		let contentType: string | undefined = undefined;
		if (transformedHeaders["content-type"] !== undefined) {
			contentType = transformedHeaders["content-type"];
		}

		let transformedBody: string | ArrayBuffer | undefined = body;
		if (ArrayBuffer.isView(body)) {
			transformedBody = bufferToArrayBuffer(body);
		}

		const param: RequestUrlParam = {
			body: transformedBody,
			headers: transformedHeaders,
			method: method,
			url: url,
			contentType: contentType,
		};

		const raceOfPromises = [
			requestUrl(param).then((rsp) => {
				const headers = rsp.headers;
				const headersLower: Record<string, string> = {};
				for (const key of Object.keys(headers)) {
					headersLower[key.toLowerCase()] = headers[key];
				}
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(rsp.arrayBuffer));
						controller.close();
					},
				});
				return {
					response: new HttpResponse({
						headers: headersLower,
						statusCode: rsp.status,
						body: stream,
					}),
				};
			}),
			requestTimeout(this.requestTimeoutInMs),
		];

		if (abortSignal) {
			raceOfPromises.push(
				new Promise<never>((resolve, reject) => {
					abortSignal.onabort = () => {
						const abortError = new Error("Request aborted");
						abortError.name = "AbortError";
						reject(abortError);
					};
				})
			);
		}
		return Promise.race(raceOfPromises);
	}
}

const bufferToArrayBuffer = (b: Buffer | Uint8Array | ArrayBufferView) => {
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

async function generateFileHash(data: Uint8Array): Promise<string> {
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return hashHex.slice(0, 32); // Truncate to same length as MD5 for compatibility
}
