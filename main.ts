import {
	App,
	Editor,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	EditorPosition,
} from "obsidian";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as mime from "mime-types";
import * as crypto from "crypto";

// Remember to rename these classes and interfaces!

interface pasteFunction {
	(this: HTMLElement, event: ClipboardEvent): void;
}

interface S3UploaderSettings {
	accessKey: string;
	secretKey: string;
	region: string;
	bucket: string;
	folder: string;
	apiEndpoint: string;
	imageUrlPath: string;
	dragAndDrop: boolean;
	localUpload: boolean;
	localUploadFolder: string;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKey: "",
	secretKey: "",
	region: "",
	bucket: "",
	folder: "",
	apiEndpoint: "",
	imageUrlPath: "",
	dragAndDrop: true,
	localUpload: false,
	localUploadFolder: "",
};

export default class MyPlugin extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
	pasteFunction: pasteFunction;

	private replaceText(
		editor: Editor,
		target: string,
		replacement: string
	): void {
		target = target.trim();
		const lines = editor.getValue().split("\n");
		for (let i = 0; i < lines.length; i++) {
			const ch = lines[i].indexOf(target);
			if (ch !== -1) {
				const from = { line: i, ch: ch } as EditorPosition;
				const to = {
					line: i,
					ch: ch + target.length,
				} as EditorPosition;
				editor.setCursor(from);
				editor.replaceRange(replacement, from, to);
				break;
			}
		}
	}

	async pasteHandler(
		ev: ClipboardEvent | DragEvent,
		editor: Editor
	): Promise<void> {
		if (ev.defaultPrevented) {
			console.log("paste event is canceled");
			return;
		}

		const noteFile = this.app.workspace.getActiveFile();

		if (!noteFile || !noteFile.name) return;

		const fm = this.app.metadataCache.getFileCache(noteFile).frontmatter;
		const perDocumentUpload = fm && fm.uploadOnDrag;
		const perDocumentUploadFolder = fm ? fm.uploadFolder : null;

		let file = null;

		if (ev.dataTransfer && ev.dataTransfer !== null) {
			if (!this.settings.dragAndDrop && !perDocumentUpload) {
				return;
			}
			file = ev.dataTransfer.files[0];
		} else {
			file = ev.clipboardData.files[0];
		}

		const imageType = /image.*/;
		if (file.type.match(imageType)) {
			ev.preventDefault();

			// set the placeholder text
			const buf = await file.arrayBuffer();
			const digest = crypto
				.createHash("md5")
				.update(new Uint8Array(buf))
				.digest("hex");
			const contentType = mime.lookup(file.name);
			const newFileName = digest + "." + mime.extension(contentType);
			const pastePlaceText = `![uploading...](${newFileName})\n`;
			editor.replaceSelection(pastePlaceText);

			// upload the image
			const folder = perDocumentUploadFolder
				? perDocumentUploadFolder
				: this.settings.folder;
			const key = folder ? folder + "/" + newFileName : newFileName;

			if (!this.settings.localUpload) {
				this.s3
					.send(
						new PutObjectCommand({
							Bucket: this.settings.bucket,
							Key: key,
							Body: file,
							ContentType: contentType,
						})
					)
					.then((res) => {
						const url = this.settings.imageUrlPath + key;
						const imgMarkdownText = `![image](${url})`;
						this.replaceText(
							editor,
							pastePlaceText,
							imgMarkdownText
						);
						new Notice("Image uploaded to S3");
					})
					.catch((err) => {
						console.log(err);
						new Notice(
							"Error uploading image to S3: " + err.message
						);
					});
			} else {
				const localUploadFolder = perDocumentUploadFolder
					? perDocumentUploadFolder
					: this.settings.localUploadFolder;
				const localUploadPath = localUploadFolder
					? localUploadFolder + "/" + newFileName
					: newFileName;
				await this.app.vault.adapter.mkdir(localUploadFolder);
				this.app.vault.adapter
					.writeBinary(localUploadPath, buf)
					.then(() => {
						const imgMarkdownText = `![image](${localUploadPath})`;
						this.replaceText(
							editor,
							pastePlaceText,
							imgMarkdownText
						);
						new Notice("Image uploaded to local folder");
					})
					.catch((err) => {
						console.log(err);
						new Notice(
							"Error uploading image to local folder: " +
								err.message
						);
					});
			}
		}
	}

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new S3UploaderSettingTab(this.app, this));

		this.settings.apiEndpoint = `https://s3.${this.settings.region}.amazonaws.com/`;
		this.settings.imageUrlPath = `https://${this.settings.bucket}.s3.${this.settings.region}.amazonaws.com/`;
		this.s3 = new S3Client({
			region: this.settings.region,
			credentials: {
				accessKeyId: this.settings.accessKey,
				secretAccessKey: this.settings.secretKey,
			},
			endpoint: this.settings.apiEndpoint,
		});

		this.pasteFunction = this.pasteHandler.bind(this);

		this.registerEvent(
			this.app.workspace.on("editor-paste", this.pasteFunction)
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.pasteFunction)
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
}

class S3UploaderSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for S3 Image Uploader" });

		new Setting(containerEl)
			.setName("AWS Access Key ID")
			.setDesc("AWS access key ID for an S3 permissioned user")
			.addText((text) =>
				text
					.setPlaceholder("access key")
					.setValue(this.plugin.settings.accessKey)
					.onChange(async (value) => {
						this.plugin.settings.accessKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("AWS Secret Key")
			.setDesc("AWS secret key for that user")
			.addText((text) =>
				text
					.setPlaceholder("secret key")
					.setValue(this.plugin.settings.secretKey)
					.onChange(async (value) => {
						this.plugin.settings.secretKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Region")
			.setDesc("AWS region of the S3 bucket")
			.addText((text) =>
				text
					.setPlaceholder("aws region")
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("S3 Bucket")
			.setDesc("S3 bucket name")
			.addText((text) =>
				text
					.setPlaceholder("bucket name")
					.setValue(this.plugin.settings.bucket)
					.onChange(async (value) => {
						this.plugin.settings.bucket = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bucket folder")
			.setDesc("Optional folder in s3 bucket")
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Upload on drag")
			.setDesc("Upload drag and drop images as well as pasted images.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.dragAndDrop)
					.onChange(async (value) => {
						this.plugin.settings.dragAndDrop = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Copy to local folder")
			.setDesc("Copy images to local folder instead of s3.")
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
			.setDesc("Local folder to save images, instead of s3")
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.localUploadFolder)
					.onChange(async (value) => {
						this.plugin.settings.localUploadFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
