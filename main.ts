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
	TFolder,
	MarkdownView,
	Menu,
	Modal,
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
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import imageCompression from "browser-image-compression";
import { minimatch } from "minimatch";

// Remember to rename these classes and interfaces!!

interface pasteFunction {
	(
		this: HTMLElement,
		event: ClipboardEvent | DragEvent,
		editor: Editor,
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
	ignorePattern: string;
	// New settings
	fallbackToLocal: boolean;
	deleteLocalAfterUpload: boolean;
	enableBatchLog: boolean;
	batchLogFolder: string;
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
	ignorePattern: "",
	// New settings defaults
	fallbackToLocal: true,
	deleteLocalAfterUpload: false,
	enableBatchLog: true,
	batchLogFolder: ".s3-logs",
};

// Batch upload types
interface BatchTask {
	file: TFile;
	notePath: string;
	matchText: string;
	localPath: string;
}

interface LogEntry {
	timestamp: string;
	fileName: string;
	originalPath: string;
	newUrl: string;
	fileSize: number;
	status: "success" | "failed" | "skipped";
	errorMessage?: string;
	duration: number;
}

interface MediaLink {
	fullMatch: string;
	type: "local" | "remote";
	path: string;
	alt: string;
	startIndex: number;
	endIndex: number;
}

export default class S3UploaderPlugin extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
	pasteFunction: pasteFunction;
	private skipAutoUploadPaths: Set<string> = new Set();

	private async replaceText(
		editor: Editor,
		target: string,
		replacement: string,
	): Promise<void> {
		const content = editor.getValue();
		const position = content.indexOf(target);

		console.log("replaceText called:", { target, replacement });

		if (position !== -1) {
			console.log("Target found at position:", position);

			// Check if we're in a table by looking for pipe characters around the target
			const surroundingBefore = content.substring(
				Math.max(0, position - 20),
				position,
			);
			const surroundingAfter = content.substring(
				position + target.length,
				Math.min(content.length, position + target.length + 20),
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

	private shouldIgnoreCurrentFile(): boolean {
		const noteFile = this.app.workspace.getActiveFile();
		if (!noteFile || !this.settings.ignorePattern) {
			return false;
		}

		const filePath = noteFile.path;
		return matchesGlobPattern(filePath, this.settings.ignorePattern);
	}

	/**
	 * Get Obsidian attachment folder path based on vault settings
	 */
	async getAttachmentFolder(currentNotePath?: string): Promise<string> {
		const config = (this.app.vault as any).getConfig("attachmentFolderPath") || "";
		const noteFile = currentNotePath
			? this.app.vault.getAbstractFileByPath(currentNotePath)
			: this.app.workspace.getActiveFile();

		if (!config || config === "/") {
			return "";
		}

		if (config === "./") {
			// Same folder as current note
			if (noteFile instanceof TFile) {
				const parentPath = noteFile.parent?.path || "";
				return parentPath;
			}
			return "";
		}

		if (config.startsWith("./")) {
			// Subfolder relative to current note
			if (noteFile instanceof TFile) {
				const parentPath = noteFile.parent?.path || "";
				const subfolder = config.slice(2);
				return parentPath ? `${parentPath}/${subfolder}` : subfolder;
			}
			return config.slice(2);
		}

		// Absolute path in vault
		return config;
	}

	/**
	 * Save file to local attachment folder (fallback when S3 upload fails)
	 */
	async saveToLocal(
		file: File,
		originalFileName: string,
	): Promise<string> {
		const folder = await this.getAttachmentFolder();
		const path = folder ? `${folder}/${originalFileName}` : originalFileName;

		// Ensure folder exists
		if (folder) {
			const folderExists = this.app.vault.getAbstractFileByPath(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
		}

		// Mark path to skip auto-upload
		this.skipAutoUploadPaths.add(path);

		const buf = await file.arrayBuffer();
		await this.app.vault.adapter.writeBinary(path, new Uint8Array(buf));

		// Remove from skip list after a delay
		setTimeout(() => {
			this.skipAutoUploadPaths.delete(path);
		}, 1000);

		return path;
	}

	/**
	 * Parse media link at cursor position
	 */
	parseMediaLink(line: string, ch: number): MediaLink | null {
		// Wikilink format: ![[path|alt]]
		const wikilinkRegex = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
		// Markdown format: ![alt](url)
		const markdownRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

		let match;

		// Check wikilinks
		while ((match = wikilinkRegex.exec(line)) !== null) {
			if (ch >= match.index && ch <= match.index + match[0].length) {
				const path = match[1];
				const isRemote = /^https?:\/\//.test(path);
				return {
					fullMatch: match[0],
					type: isRemote ? "remote" : "local",
					path: path,
					alt: match[2] || "",
					startIndex: match.index,
					endIndex: match.index + match[0].length,
				};
			}
		}

		// Check markdown links
		while ((match = markdownRegex.exec(line)) !== null) {
			if (ch >= match.index && ch <= match.index + match[0].length) {
				const url = match[2];
				const isRemote = /^https?:\/\//.test(url);
				return {
					fullMatch: match[0],
					type: isRemote ? "remote" : "local",
					path: url,
					alt: match[1] || "",
					startIndex: match.index,
					endIndex: match.index + match[0].length,
				};
			}
		}

		return null;
	}

	/**
	 * Check if S3 object exists by key
	 */
	async s3ObjectExists(key: string): Promise<boolean> {
		if (!this.s3) return false;
		try {
			await this.s3.send(
				new HeadObjectCommand({
					Bucket: this.settings.bucket,
					Key: key,
				}),
			);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Delete S3 object
	 */
	async deleteS3Object(key: string): Promise<void> {
		if (!this.s3) {
			throw new Error("S3 client not configured");
		}
		await this.s3.send(
			new DeleteObjectCommand({
				Bucket: this.settings.bucket,
				Key: key,
			}),
		);
	}

	/**
	 * Download file from URL to local attachment folder
	 */
	async downloadFromS3(url: string, currentNotePath?: string): Promise<string> {
		const response = await requestUrl({ url });
		if (response.status !== 200) {
			throw new Error(`Failed to download: ${response.status}`);
		}

		// Extract filename from URL
		const urlPath = new URL(url).pathname;
		const fileName = urlPath.split("/").pop() || `download_${Date.now()}`;

		const folder = await this.getAttachmentFolder(currentNotePath);
		const localPath = folder ? `${folder}/${fileName}` : fileName;

		// Ensure folder exists
		if (folder) {
			const folderExists = this.app.vault.getAbstractFileByPath(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
		}

		// Mark path to skip auto-upload
		this.skipAutoUploadPaths.add(localPath);

		await this.app.vault.adapter.writeBinary(
			localPath,
			new Uint8Array(response.arrayBuffer),
		);

		// Remove from skip list after a delay
		setTimeout(() => {
			this.skipAutoUploadPaths.delete(localPath);
		}, 1000);

		return localPath;
	}

	/**
	 * Extract S3 key from URL
	 */
	extractS3KeyFromUrl(url: string): string | null {
		try {
			const urlObj = new URL(url);
			// Handle both path-style and host-style URLs
			let path = urlObj.pathname;
			if (path.startsWith("/")) {
				path = path.slice(1);
			}
			// If path-style, remove bucket name
			if (
				this.settings.forcePathStyle &&
				path.startsWith(this.settings.bucket + "/")
			) {
				path = path.slice(this.settings.bucket.length + 1);
			}
			return path || null;
		} catch {
			return null;
		}
	}

	/**
	 * Scan markdown files for local image links
	 */
	async scanLocalImages(
		scope: "vault" | "folder",
		folderPath?: string,
	): Promise<BatchTask[]> {
		const tasks: BatchTask[] = [];
		let files: TFile[];

		if (scope === "vault") {
			files = this.app.vault.getMarkdownFiles();
		} else {
			const folder = folderPath
				? this.app.vault.getAbstractFileByPath(folderPath)
				: null;
			if (!(folder instanceof TFolder)) {
				return tasks;
			}
			files = this.app.vault.getMarkdownFiles().filter((f) =>
				f.path.startsWith(folder.path + "/"),
			);
		}

		const wikilinkRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

		for (const file of files) {
			const content = await this.app.vault.read(file);
			let match;

			while ((match = wikilinkRegex.exec(content)) !== null) {
				const localPath = match[1];
				// Skip if already a URL
				if (/^https?:\/\//.test(localPath)) continue;

				// Check if file exists
				const linkedFile =
					this.app.metadataCache.getFirstLinkpathDest(localPath, file.path);
				if (
					linkedFile instanceof TFile &&
					/\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mp3|wav|pdf)$/i.test(
						linkedFile.path,
					)
				) {
					tasks.push({
						file: linkedFile,
						notePath: file.path,
						matchText: match[0],
						localPath: linkedFile.path,
					});
				}
			}
		}

		return tasks;
	}

	/**
	 * Execute batch upload
	 */
	async executeBatchUpload(
		tasks: BatchTask[],
		progressCallback?: (current: number, total: number) => void,
	): Promise<LogEntry[]> {
		const logs: LogEntry[] = [];
		const processedHashes = new Set<string>();
		let current = 0;

		for (const task of tasks) {
			current++;
			progressCallback?.(current, tasks.length);

			const startTime = Date.now();
			const fileContent = await this.app.vault.readBinary(task.file);
			const hash = await generateFileHash(new Uint8Array(fileContent));

			// Skip if already processed (same hash)
			if (processedHashes.has(hash)) {
				logs.push({
					timestamp: new Date().toISOString(),
					fileName: task.file.name,
					originalPath: task.localPath,
					newUrl: "",
					fileSize: task.file.stat.size,
					status: "skipped",
					errorMessage: "Duplicate file (same hash)",
					duration: Date.now() - startTime,
				});
				continue;
			}

			const ext = task.file.extension;
			const newFileName = `${hash}.${ext}`;

			// Get note file for basename variable replacement
			const noteFile = this.app.vault.getAbstractFileByPath(task.notePath);
			const basename = noteFile instanceof TFile ? noteFile.basename.replace(/ /g, "-") : "";

			// Replace variables in folder path
			const currentDate = new Date();
			const folder = (this.settings.folder || "")
				.replace("${year}", currentDate.getFullYear().toString())
				.replace("${month}", String(currentDate.getMonth() + 1).padStart(2, "0"))
				.replace("${day}", String(currentDate.getDate()).padStart(2, "0"))
				.replace("${basename}", basename);

			const key = folder ? `${folder}/${newFileName}` : newFileName;

			// Check if already exists on S3
			const exists = await this.s3ObjectExists(key);
			if (exists) {
				processedHashes.add(hash);
				// Still update the link
				const url = this.settings.imageUrlPath + key;
				await this.updateLinkInNote(task.notePath, task.matchText, url, task.file.extension);

				logs.push({
					timestamp: new Date().toISOString(),
					fileName: task.file.name,
					originalPath: task.localPath,
					newUrl: url,
					fileSize: task.file.stat.size,
					status: "skipped",
					errorMessage: "Already exists on S3",
					duration: Date.now() - startTime,
				});
				continue;
			}

			try {
				const file = new File([fileContent], task.file.name, {
					type: getMimeType(task.file.extension),
				});
				const url = await this.uploadFile(file, key);
				processedHashes.add(hash);

				// Update link in note
				await this.updateLinkInNote(task.notePath, task.matchText, url, task.file.extension);

				// Delete local file if setting enabled
				if (this.settings.deleteLocalAfterUpload) {
					await this.app.vault.trash(task.file, true);
				}

				logs.push({
					timestamp: new Date().toISOString(),
					fileName: task.file.name,
					originalPath: task.localPath,
					newUrl: url,
					fileSize: task.file.stat.size,
					status: "success",
					duration: Date.now() - startTime,
				});
			} catch (error) {
				logs.push({
					timestamp: new Date().toISOString(),
					fileName: task.file.name,
					originalPath: task.localPath,
					newUrl: "",
					fileSize: task.file.stat.size,
					status: "failed",
					errorMessage: error.message,
					duration: Date.now() - startTime,
				});
			}
		}

		return logs;
	}

	/**
	 * Update link in note file
	 */
	async updateLinkInNote(
		notePath: string,
		oldLink: string,
		newUrl: string,
		extension: string,
	): Promise<void> {
		const noteFile = this.app.vault.getAbstractFileByPath(notePath);
		if (!(noteFile instanceof TFile)) return;

		let content = await this.app.vault.read(noteFile);
		const mediaType = getMediaType(extension);
		const newLink = wrapFileDependingOnType(newUrl, mediaType, "");
		content = content.split(oldLink).join(newLink);
		await this.app.vault.modify(noteFile, content);
	}

	/**
	 * Generate batch log file
	 */
	async generateBatchLog(logs: LogEntry[], scope: string): Promise<string> {
		if (!this.settings.enableBatchLog) return "";

		const folder = this.settings.batchLogFolder;
		if (folder) {
			const folderExists = this.app.vault.getAbstractFileByPath(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
		}

		const now = new Date();
		const fileName = `s3-upload-log-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}.md`;
		const filePath = folder ? `${folder}/${fileName}` : fileName;

		const successCount = logs.filter((l) => l.status === "success").length;
		const failedCount = logs.filter((l) => l.status === "failed").length;
		const skippedCount = logs.filter((l) => l.status === "skipped").length;
		const totalDuration = logs.reduce((sum, l) => sum + l.duration, 0);

		let content = `# S3 Upload Log - ${now.toISOString()}\n\n`;
		content += `## Summary\n`;
		content += `- Scope: ${scope}\n`;
		content += `- Total: ${logs.length} files\n`;
		content += `- Success: ${successCount}\n`;
		content += `- Failed: ${failedCount}\n`;
		content += `- Skipped: ${skippedCount}\n`;
		content += `- Duration: ${(totalDuration / 1000).toFixed(2)}s\n\n`;

		content += `## Details\n`;
		content += `| File | Status | Size | Original Path | New URL | Duration | Error |\n`;
		content += `|------|--------|------|---------------|---------|----------|-------|\n`;

		for (const log of logs) {
			const size = filesize(log.fileSize);
			const duration = `${(log.duration / 1000).toFixed(2)}s`;
			const error = log.errorMessage || "";
			content += `| ${log.fileName} | ${log.status} | ${size} | ${log.originalPath} | ${log.newUrl || "-"} | ${duration} | ${error} |\n`;
		}

		await this.app.vault.create(filePath, content);
		return filePath;
	}

	/**
	 * Start batch upload with progress modal
	 */
	async batchUpload(scope: "vault" | "folder", folderPath?: string): Promise<void> {
		new Notice(`Scanning for local images...`);
		const tasks = await this.scanLocalImages(scope, folderPath);

		if (tasks.length === 0) {
			new Notice("No local images found to upload");
			return;
		}

		const confirmed = await new Promise<boolean>((resolve) => {
			const modal = new BatchConfirmModal(this.app, tasks.length, resolve);
			modal.open();
		});

		if (!confirmed) return;

		new Notice(`Starting batch upload of ${tasks.length} files...`);

		const logs = await this.executeBatchUpload(tasks, (current, total) => {
			if (current % 5 === 0 || current === total) {
				new Notice(`Uploading: ${current}/${total}`);
			}
		});

		const successCount = logs.filter((l) => l.status === "success").length;
		const failedCount = logs.filter((l) => l.status === "failed").length;

		new Notice(
			`Batch upload complete: ${successCount} success, ${failedCount} failed`,
		);

		if (this.settings.enableBatchLog) {
			const logPath = await this.generateBatchLog(
				logs,
				scope === "vault" ? "Full Vault" : `Folder: ${folderPath}`,
			);
			if (logPath) {
				new Notice(`Log saved to ${logPath}`);
			}
		}
	}

	/**
	 * Upload all local images in a specific file
	 */
	async uploadAllImagesInFile(noteFile: TFile): Promise<void> {
		const content = await this.app.vault.read(noteFile);
		const wikilinkRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?]]/g;
		const tasks: BatchTask[] = [];

		let match;
		while ((match = wikilinkRegex.exec(content)) !== null) {
			const localPath = match[1];
			// Skip if already a URL
			if (/^https?:\/\//.test(localPath)) continue;

			// Check if file exists
			const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
				localPath,
				noteFile.path,
			);
			if (
				linkedFile instanceof TFile &&
				/\.(jpg|jpeg|png|gif|webp|bmp|svg|mp4|webm|mp3|wav|pdf)$/i.test(
					linkedFile.path,
				)
			) {
				tasks.push({
					file: linkedFile,
					notePath: noteFile.path,
					matchText: match[0],
					localPath: linkedFile.path,
				});
			}
		}

		if (tasks.length === 0) {
			new Notice("No local images found in this file");
			return;
		}

		new Notice(`Uploading ${tasks.length} images...`);

		const logs = await this.executeBatchUpload(tasks, (current, total) => {
			if (current % 3 === 0 || current === total) {
				new Notice(`Uploading: ${current}/${total}`);
			}
		});

		const successCount = logs.filter((l) => l.status === "success").length;
		const failedCount = logs.filter((l) => l.status === "failed").length;
		const skippedCount = logs.filter((l) => l.status === "skipped").length;

		new Notice(
			`Upload complete: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`,
		);
	}

	async uploadFile(file: File, key: string): Promise<string> {
		// Check if S3 client is initialized
		if (!this.s3) {
			throw new Error(
				"S3 client not configured. Please configure the plugin settings first.",
			);
		}

		const buf = await file.arrayBuffer();
		await this.s3.send(
			new PutObjectCommand({
				Bucket: this.settings.bucket,
				Key: key,
				Body: new Uint8Array(buf),
				ContentType: file.type,
			}),
		);
		let urlString = this.settings.imageUrlPath + key;
		if (this.settings.queryStringKey && this.settings.queryStringValue) {
			const urlObject = new URL(urlString);

			// The searchParams property provides methods to manipulate query parameters
			urlObject.searchParams.append(
				this.settings.queryStringKey,
				this.settings.queryStringValue,
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
		directFile?: File,
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
						(ev as ClipboardEvent).clipboardData?.files || [],
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
						(ev as DragEvent).dataTransfer?.files || [],
					);
					break;
				case "input":
					files = Array.from(
						(ev.target as HTMLInputElement).files || [],
					);
					break;
			}
		}

		// Only prevent default and proceed if we have files to handle AND file is not ignored
		if (files.length > 0) {
			// Check if uploads should be ignored for this file AFTER we know there are files
			// but BEFORE we prevent default behavior
			if (this.shouldIgnoreCurrentFile()) {
				return; // Let default Obsidian behavior handle the files
			}

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
						String(currentDate.getMonth() + 1).padStart(2, "0"),
					)
					.replace(
						"${day}",
						String(currentDate.getDate()).padStart(2, "0"),
					)
					.replace(
						"${basename}",
						noteFile.basename.replace(/ /g, "-"),
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
							new Uint8Array(buf),
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
					// Fallback to local save if enabled
					if (this.settings.fallbackToLocal && !localUpload) {
						try {
							// Use newFileName (hash-based) for unique naming
							const fallbackFile = new File([buf], newFileName, {
								type: file.type,
							});
							const localPath = await this.saveToLocal(fallbackFile, newFileName);
							new Notice(`S3 upload failed, saved locally: ${newFileName}`);
							return `![[${localPath}]]`;
						} catch (localError) {
							console.error("Local fallback also failed:", localError);
							return `Error uploading file: ${error.message}`;
						}
					}
					return `Error uploading file: ${error.message}`;
				}
			});

			try {
				// Wait for all uploads to complete
				const results = await Promise.all(uploads);

				// Filter out undefined results (from unsupported file types)
				const validResults = results.filter(
					(result) => result !== undefined,
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
		// Don't create S3 client if region is not configured
		if (!this.settings.region) {
			return;
		}

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
			editor: Editor,
		) => {
			this.pasteHandler(event, editor);
		};

		this.registerEvent(
			this.app.workspace.on("editor-paste", this.pasteFunction),
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.pasteFunction),
		);

		// Register batch upload commands
		this.addCommand({
			id: "batch-upload-vault",
			name: "Batch upload all local images in vault",
			icon: "upload-cloud",
			callback: () => this.batchUpload("vault"),
		});

		this.addCommand({
			id: "batch-upload-current-folder",
			name: "Batch upload local images in current folder",
			icon: "folder-up",
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile?.parent) {
					this.batchUpload("folder", activeFile.parent.path);
				} else {
					new Notice("No active folder");
				}
			},
		});

		// Register folder right-click menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("S3: Batch upload images")
							.setIcon("upload-cloud")
							.onClick(() => this.batchUpload("folder", file.path));
					});
				}
			}),
		);

		// Register editor right-click menu for media links
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, view: MarkdownView) => {
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const mediaLink = this.parseMediaLink(line, cursor.ch);

				if (mediaLink) {
					this.addMediaContextMenu(menu, mediaLink, editor, view);
				}

				// Always add "Upload all images in current file" option
				menu.addItem((item) => {
					item.setTitle("S3: Upload all local images in this file")
						.setIcon("upload-cloud")
						.onClick(async () => {
							if (!view.file) {
								new Notice("No active file");
								return;
							}
							await this.uploadAllImagesInFile(view.file);
						});
				});
			}),
		);

		// Add mobile-specific event monitoring
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (!(file instanceof TFile)) return;
				if (!file.path.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return;

				// Skip files created by internal operations (download, fallback save)
				if (this.skipAutoUploadPaths.has(file.path)) {
					return;
				}

				const activeView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) return;

				// Check if uploads should be ignored for the current file
				if (this.shouldIgnoreCurrentFile()) {
					return; // Don't process the file, let Obsidian handle it normally
				}

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
						"useMarkdownLinks",
					)
						? `![](${file.name.split(" ").join("%20")})`
						: `![[${file.name}]]`; // Exact pattern we want to find
					const position = content.indexOf(obsidianLink);

					if (position !== -1) {
						const from = activeView.editor.offsetToPos(position);
						const to = activeView.editor.offsetToPos(
							position + obsidianLink.length,
						);
						activeView.editor.replaceRange("", from, to);
					} else {
						new Notice(`Failed to find: ${obsidianLink}`);
					}

					await this.app.vault.delete(file);
				} catch (error) {
					new Notice(`Error processing file: ${error.message}`);
				}
			}),
		);
	}

	/**
	 * Add context menu items for media links
	 */
	addMediaContextMenu(
		menu: Menu,
		mediaLink: MediaLink,
		editor: Editor,
		view: MarkdownView,
	): void {
		if (mediaLink.type === "local") {
			// Local file - offer to upload to S3
			menu.addItem((item) => {
				item.setTitle("S3: Upload to cloud")
					.setIcon("upload-cloud")
					.onClick(async () => {
						try {
							const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
								mediaLink.path,
								view.file?.path || "",
							);
							if (!(linkedFile instanceof TFile)) {
								new Notice("File not found");
								return;
							}

							const fileContent = await this.app.vault.readBinary(linkedFile);
							const hash = await generateFileHash(new Uint8Array(fileContent));
							const ext = linkedFile.extension;
							const newFileName = `${hash}.${ext}`;
							const folder = this.settings.folder || "";
							const key = folder ? `${folder}/${newFileName}` : newFileName;

							const file = new File([fileContent], linkedFile.name, {
								type: getMimeType(ext),
							});

							new Notice("Uploading to S3...");
							const url = await this.uploadFile(file, key);

							// Replace link in editor
							const line = editor.getLine(editor.getCursor().line);
							const mediaType = getMediaType(ext);
							const newLink = wrapFileDependingOnType(url, mediaType, "");
							const newLine = line.substring(0, mediaLink.startIndex) +
								newLink +
								line.substring(mediaLink.endIndex);

							const cursor = editor.getCursor();
							editor.setLine(cursor.line, newLine);

							// Delete local file if setting enabled
							if (this.settings.deleteLocalAfterUpload) {
								await this.app.vault.trash(linkedFile, true);
							}

							new Notice("Uploaded successfully!");
						} catch (error) {
							new Notice(`Upload failed: ${error.message}`);
						}
					});
			});

			// Delete local file
			menu.addItem((item) => {
				item.setTitle("S3: Delete local file")
					.setIcon("trash-2")
					.onClick(async () => {
						try {
							const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
								mediaLink.path,
								view.file?.path || "",
							);
							if (!(linkedFile instanceof TFile)) {
								new Notice("File not found");
								return;
							}

							// Confirm deletion
							const confirmed = await new Promise<boolean>((resolve) => {
								const modal = new DeleteConfirmModal(
									this.app,
									linkedFile.path,
									resolve,
								);
								modal.open();
							});

							if (!confirmed) return;

							// Delete the file
							await this.app.vault.trash(linkedFile, true);

							// Remove the link from editor
							const line = editor.getLine(editor.getCursor().line);
							const newLine = line.substring(0, mediaLink.startIndex) +
								line.substring(mediaLink.endIndex);

							const cursor = editor.getCursor();
							editor.setLine(cursor.line, newLine.trim());

							new Notice("Local file deleted!");
						} catch (error) {
							new Notice(`Delete failed: ${error.message}`);
						}
					});
			});

			// Rename alt text (only for local images)
			menu.addItem((item) => {
				item.setTitle("S3: Rename description")
					.setIcon("pencil")
					.onClick(async () => {
						const newAlt = await new Promise<string | null>((resolve) => {
							const modal = new RenameAltModal(this.app, mediaLink.alt, resolve);
							modal.open();
						});

						if (newAlt === null) return;

						const line = editor.getLine(editor.getCursor().line);
						let newLink: string;

						// Handle wikilink format ![[path|alt]]
						if (mediaLink.fullMatch.startsWith("![[")) {
							if (newAlt) {
								newLink = `![[${mediaLink.path}|${newAlt}]]`;
							} else {
								newLink = `![[${mediaLink.path}]]`;
							}
						} else {
							// Handle markdown format ![alt](url)
							newLink = `![${newAlt}](${mediaLink.path})`;
						}

						const newLine = line.substring(0, mediaLink.startIndex) +
							newLink +
							line.substring(mediaLink.endIndex);

						const cursor = editor.getCursor();
						editor.setLine(cursor.line, newLine);
						new Notice("Description updated!");
					});
			});
		} else {
			// Remote URL - offer to download or delete
			menu.addItem((item) => {
				item.setTitle("S3: Download to local")
					.setIcon("download")
					.onClick(async () => {
						try {
							new Notice("Downloading from S3...");
							const localPath = await this.downloadFromS3(mediaLink.path, view.file?.path);

							// Replace link in editor
							const line = editor.getLine(editor.getCursor().line);
							const newLink = `![[${localPath}]]`;
							const newLine = line.substring(0, mediaLink.startIndex) +
								newLink +
								line.substring(mediaLink.endIndex);

							const cursor = editor.getCursor();
							editor.setLine(cursor.line, newLine);

							new Notice(`Downloaded to ${localPath}`);
						} catch (error) {
							new Notice(`Download failed: ${error.message}`);
						}
					});
			});

			// Check if it's an S3 URL from our bucket
			const s3Key = this.extractS3KeyFromUrl(mediaLink.path);
			if (s3Key) {
				menu.addItem((item) => {
					item.setTitle("S3: Delete from cloud")
						.setIcon("trash-2")
						.onClick(async () => {
							const confirmed = await new Promise<boolean>((resolve) => {
								const modal = new DeleteConfirmModal(this.app, s3Key, resolve);
								modal.open();
							});

							if (!confirmed) return;

							try {
								new Notice("Deleting from S3...");
								await this.deleteS3Object(s3Key);

								// Remove the link from editor
								const line = editor.getLine(editor.getCursor().line);
								const newLine = line.substring(0, mediaLink.startIndex) +
									line.substring(mediaLink.endIndex);

								const cursor = editor.getCursor();
								editor.setLine(cursor.line, newLine.trim());

								new Notice("Deleted from S3!");
							} catch (error) {
								new Notice(`Delete failed: ${error.message}`);
							}
						});
				});
			}
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
					}),
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
					}),
			);

		new Setting(containerEl)
			.setName("Bucket folder")
			.setDesc(
				"Optional folder in s3 bucket. Support the use of ${year}, ${month}, ${day} and ${basename} variables.",
			)
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Upload on drag")
			.setDesc(
				"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note.",
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
				"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note.",
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
				"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note.",
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
				"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files.",
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
				"Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note.  This will copy the images to a folder in your local file system, instead of s3.",
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
				'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note.  This affects only local uploads.',
			)
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.localUploadFolder)
					.onChange(async (value) => {
						this.plugin.settings.localUploadFolder = value.trim();
						await this.plugin.saveSettings();
					}),
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
				"Optionally set a custom endpoint for any S3 compatible storage provider.",
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
					}),
			);

		new Setting(containerEl)
			.setName("S3 Path Style URLs")
			.setDesc(
				"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com).",
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
				"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.",
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
					}),
			);

		new Setting(containerEl)
			.setName("Bypass local CORS check")
			.setDesc(
				"Bypass local CORS preflight checks - it might work on later versions of Obsidian.",
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
					}),
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
					}),
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
				"Maximum size of the image after compression in MB. Default is 1MB.",
			)
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(
						this.plugin.settings.maxImageCompressionSize.toString(),
					)
					.onChange(async (value) => {
						// It must be a number, it must be greater than 0
						const newValue = parseFloat(value);
						if (isNaN(newValue) || newValue <= 0) {
							new Notice(
								"Max Image Compression Size must be a number greater than 0",
							);
							return;
						}

						this.plugin.settings.maxImageCompressionSize = newValue;
						await this.plugin.saveSettings();
					}),
			);

		this.compressionQualitySettings = new Setting(containerEl)
			.setName("Image Compression Quality")
			.setDesc(
				"Maximum quality of the image after compression. Default is 0.7.",
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
				"Maximum width or height of the image after compression. Default is 4096px.",
			)
			.addText((text) =>
				text
					.setPlaceholder("4096")
					.setValue(
						this.plugin.settings.maxImageWidthOrHeight.toString(),
					)
					.onChange(async (value) => {
						const parsedValue = parseInt(value);

						if (isNaN(parsedValue) || parsedValue <= 0) {
							new Notice(
								"Max Image Width or Height must be a number greater than 0",
							);
							return;
						}

						this.plugin.settings.maxImageWidthOrHeight =
							parsedValue;
						await this.plugin.saveSettings();
					}),
			);

		// Set initial visibility based on current settings
		this.toggleCompressionSettings(
			this.plugin.settings.enableImageCompression,
		);

		new Setting(containerEl)
			.setName("Ignore Pattern")
			.setDesc(
				"Glob pattern to ignore files/folders. Use * for any characters, ** for any path, ? for single character. Separate multiple patterns with commas. Example: 'private/*, **/drafts/**, temp*'",
			)
			.addText((text) =>
				text
					.setPlaceholder("private/*, **/drafts/**")
					.setValue(this.plugin.settings.ignorePattern)
					.onChange(async (value) => {
						this.plugin.settings.ignorePattern = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		// New settings section
		containerEl.createEl("h3", { text: "Advanced Upload Settings" });

		new Setting(containerEl)
			.setName("Fallback to local on upload failure")
			.setDesc(
				"When S3 upload fails, save the file to local attachment folder instead.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.fallbackToLocal)
					.onChange(async (value) => {
						this.plugin.settings.fallbackToLocal = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Delete local file after upload")
			.setDesc(
				"Delete the local file after successfully uploading to S3. Files will be moved to system trash.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.deleteLocalAfterUpload)
					.onChange(async (value) => {
						this.plugin.settings.deleteLocalAfterUpload = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Enable batch upload log")
			.setDesc(
				"Generate a log file after batch upload operations with details about each file.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableBatchLog)
					.onChange(async (value) => {
						this.plugin.settings.enableBatchLog = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Batch log folder")
			.setDesc("Folder to store batch upload log files.")
			.addText((text) =>
				text
					.setPlaceholder(".s3-logs")
					.setValue(this.plugin.settings.batchLogFolder)
					.onChange(async (value) => {
						this.plugin.settings.batchLogFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
	const hider = text.inputEl.insertAdjacentElement(
		"beforebegin",
		createSpan(),
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
	localBase: string,
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
		{ abortSignal }: HttpHandlerOptions = {},
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
				}),
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

/**
 * Check if a file path matches a glob pattern using minimatch
 * Supports standard glob patterns: *, **, ?, etc.
 */
function matchesGlobPattern(filePath: string, pattern: string): boolean {
	if (!pattern || pattern.trim() === "") {
		return false;
	}

	// Split patterns by comma to support multiple patterns
	const patterns = pattern.split(",").map((p) => p.trim());

	return patterns.some((p) => {
		return minimatch(filePath, p);
	});
}

/**
 * Get MIME type from file extension
 */
function getMimeType(extension: string): string {
	const mimeTypes: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		webp: "image/webp",
		bmp: "image/bmp",
		svg: "image/svg+xml",
		mp4: "video/mp4",
		webm: "video/webm",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		pdf: "application/pdf",
	};
	return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}

/**
 * Get media type category from file extension
 */
function getMediaType(extension: string): string {
	const ext = extension.toLowerCase();
	if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext)) {
		return "image";
	}
	if (["mp4", "webm"].includes(ext)) {
		return "video";
	}
	if (["mp3", "wav"].includes(ext)) {
		return "audio";
	}
	if (ext === "pdf") {
		return "pdf";
	}
	return "image";
}

/**
 * Modal for batch upload confirmation
 */
class BatchConfirmModal extends Modal {
	private count: number;
	private resolve: (value: boolean) => void;

	constructor(app: App, count: number, resolve: (value: boolean) => void) {
		super(app);
		this.count = count;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Batch Upload Confirmation" });
		contentEl.createEl("p", {
			text: `Found ${this.count} local media files to upload. Continue?`,
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const confirmBtn = buttonContainer.createEl("button", {
			text: "Upload All",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			this.resolve(true);
			this.close();
		});

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.resolve(false);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for renaming alt text
 */
class RenameAltModal extends Modal {
	private currentAlt: string;
	private resolve: (value: string | null) => void;

	constructor(app: App, currentAlt: string, resolve: (value: string | null) => void) {
		super(app);
		this.currentAlt = currentAlt;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Rename Description" });

		const inputEl = contentEl.createEl("input", {
			type: "text",
			value: this.currentAlt,
			cls: "rename-alt-input",
		});
		inputEl.style.width = "100%";
		inputEl.style.marginBottom = "1em";

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const confirmBtn = buttonContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			this.resolve(inputEl.value);
			this.close();
		});

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.resolve(null);
			this.close();
		});

		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.resolve(inputEl.value);
				this.close();
			}
		});

		inputEl.focus();
		inputEl.select();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for delete confirmation
 */
class DeleteConfirmModal extends Modal {
	private s3Key: string;
	private resolve: (value: boolean) => void;

	constructor(app: App, s3Key: string, resolve: (value: boolean) => void) {
		super(app);
		this.s3Key = s3Key;
		this.resolve = resolve;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Delete from S3" });
		contentEl.createEl("p", {
			text: `Are you sure you want to delete this file from S3?`,
		});
		contentEl.createEl("code", { text: this.s3Key });
		contentEl.createEl("p", {
			text: "This action cannot be undone.",
			cls: "mod-warning",
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const confirmBtn = buttonContainer.createEl("button", {
			text: "Delete",
			cls: "mod-warning",
		});
		confirmBtn.addEventListener("click", () => {
			this.resolve(true);
			this.close();
		});

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.resolve(false);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
